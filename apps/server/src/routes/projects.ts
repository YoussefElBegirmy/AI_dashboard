import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { encrypt, preview, randomToken, sha256 } from "../lib/crypto";
import { HttpError, notFound, param, parseBody } from "../lib/http";
import { assertRole, projectId, requireUser } from "../middleware/auth";

const roleEnum = z.enum(["OWNER", "EDITOR", "VIEWER"]);

/** /api/projects (no project context) */
export const projectsRouter = Router();
projectsRouter.use(requireUser);

projectsRouter.get("/", async (req, res) => {
  const memberships = await prisma.projectMember.findMany({
    where: { userId: req.user!.id },
    include: { project: { include: { _count: { select: { targets: true, suites: true, mcpServers: true, members: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(memberships.map((m) => ({ ...m.project, role: m.role })));
});

projectsRouter.post("/", async (req, res) => {
  if (req.tokenProjectId) throw new HttpError(403, "API tokens cannot create projects");
  const body = parseBody(z.object({ name: z.string().min(1).max(120), description: z.string().max(2000).default("") }), req);
  const project = await prisma.project.create({ data: { ...body, members: { create: { userId: req.user!.id, role: "OWNER" } } } });
  res.status(201).json({ ...project, role: "OWNER" });
});

/** /api/projects/:projectId (requireProject applied by the parent router) */
export const projectRouter = Router({ mergeParams: true });

projectRouter.get("/", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: projectId(req) } });
  res.json({ ...project, role: req.member!.role });
});

projectRouter.patch("/", async (req, res) => {
  assertRole(req, "OWNER");
  const body = parseBody(z.object({ name: z.string().min(1).max(120).optional(), description: z.string().max(2000).optional() }), req);
  res.json(await prisma.project.update({ where: { id: projectId(req) }, data: body }));
});

projectRouter.delete("/", async (req, res) => {
  assertRole(req, "OWNER");
  await prisma.project.delete({ where: { id: projectId(req) } });
  res.json({ ok: true });
});

// ---- members & invites ----

projectRouter.get("/members", async (req, res) => {
  const [members, invites] = await Promise.all([
    prisma.projectMember.findMany({
      where: { projectId: projectId(req) },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invite.findMany({ where: { projectId: projectId(req), acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  res.json({
    members,
    invites: invites.map((i) => ({ ...i, link: `${env.appUrl}/register?invite=${i.token}` })),
  });
});

projectRouter.post("/members", async (req, res) => {
  assertRole(req, "OWNER");
  const body = parseBody(z.object({ email: z.email().transform((e) => e.toLowerCase()), role: roleEnum.default("EDITOR") }), req);
  const pid = projectId(req);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user) {
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: pid, userId: user.id } },
      create: { projectId: pid, userId: user.id, role: body.role },
      update: { role: body.role },
    });
    return res.status(201).json({ added: true, member });
  }
  const invite = await prisma.invite.create({
    data: {
      token: randomToken(),
      email: body.email,
      role: body.role,
      projectId: pid,
      createdById: req.user!.id,
      expiresAt: new Date(Date.now() + 14 * 24 * 3600_000),
    },
  });
  res.status(201).json({ added: false, invite: { ...invite, link: `${env.appUrl}/register?invite=${invite.token}` } });
});

projectRouter.patch("/members/:memberId", async (req, res) => {
  assertRole(req, "OWNER");
  const { role } = parseBody(z.object({ role: roleEnum }), req);
  const member = await prisma.projectMember.findFirst({ where: { id: param(req, "memberId"), projectId: projectId(req) } });
  if (!member) throw notFound("Member");
  if (member.role === "OWNER" && role !== "OWNER") {
    const owners = await prisma.projectMember.count({ where: { projectId: projectId(req), role: "OWNER" } });
    if (owners <= 1) throw new HttpError(400, "A project needs at least one owner");
  }
  res.json(await prisma.projectMember.update({ where: { id: member.id }, data: { role } }));
});

projectRouter.delete("/members/:memberId", async (req, res) => {
  const member = await prisma.projectMember.findFirst({ where: { id: param(req, "memberId"), projectId: projectId(req) } });
  if (!member) throw notFound("Member");
  if (member.userId !== req.user!.id) assertRole(req, "OWNER");
  if (member.role === "OWNER") {
    const owners = await prisma.projectMember.count({ where: { projectId: projectId(req), role: "OWNER" } });
    if (owners <= 1) throw new HttpError(400, "A project needs at least one owner");
  }
  await prisma.projectMember.delete({ where: { id: member.id } });
  res.json({ ok: true });
});

projectRouter.delete("/invites/:inviteId", async (req, res) => {
  assertRole(req, "OWNER");
  await prisma.invite.deleteMany({ where: { id: param(req, "inviteId"), projectId: projectId(req) } });
  res.json({ ok: true });
});

// ---- API tokens (for CI) ----

projectRouter.get("/tokens", async (req, res) => {
  const tokens = await prisma.apiToken.findMany({
    where: { projectId: projectId(req), userId: req.user!.id },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(tokens);
});

projectRouter.post("/tokens", async (req, res) => {
  assertRole(req, "EDITOR");
  if (req.tokenProjectId) throw new HttpError(403, "API tokens cannot create tokens");
  const { name } = parseBody(z.object({ name: z.string().min(1).max(100) }), req);
  const token = `aie_${randomToken(32)}`;
  const row = await prisma.apiToken.create({
    data: { name, prefix: token.slice(0, 10), tokenHash: sha256(token), userId: req.user!.id, projectId: projectId(req) },
  });
  res.status(201).json({ id: row.id, name: row.name, prefix: row.prefix, createdAt: row.createdAt, token });
});

projectRouter.delete("/tokens/:tokenId", async (req, res) => {
  await prisma.apiToken.deleteMany({ where: { id: param(req, "tokenId"), projectId: projectId(req), userId: req.user!.id } });
  res.json({ ok: true });
});

// ---- secrets ----

const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

projectRouter.get("/secrets", async (req, res) => {
  const secrets = await prisma.secret.findMany({
    where: { projectId: projectId(req) },
    select: { id: true, name: true, preview: true, createdAt: true, updatedAt: true },
    orderBy: { name: "asc" },
  });
  const envFallbacks = Object.entries(env.fallbackSecrets)
    .filter(([name, v]) => v && !secrets.some((s) => s.name === name))
    .map(([name]) => name);
  res.json({ secrets, envFallbacks });
});

projectRouter.put("/secrets/:name", async (req, res) => {
  assertRole(req, "EDITOR");
  const name = param(req, "name");
  if (!SECRET_NAME.test(name)) throw new HttpError(400, "Secret names use letters, digits and underscores");
  const { value } = parseBody(z.object({ value: z.string().min(1).max(20_000) }), req);
  const data = { value: encrypt(value), preview: preview(value) };
  const secret = await prisma.secret.upsert({
    where: { projectId_name: { projectId: projectId(req), name } },
    create: { projectId: projectId(req), name, ...data },
    update: data,
    select: { id: true, name: true, preview: true, updatedAt: true },
  });
  res.json(secret);
});

projectRouter.delete("/secrets/:name", async (req, res) => {
  assertRole(req, "EDITOR");
  await prisma.secret.deleteMany({ where: { projectId: projectId(req), name: param(req, "name") } });
  res.json({ ok: true });
});
