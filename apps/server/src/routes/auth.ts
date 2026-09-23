import bcrypt from "bcryptjs";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { HttpError, param, parseBody } from "../lib/http";
import { requireUser } from "../middleware/auth";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().min(1).max(100),
  password: z.string().min(8, "At least 8 characters").max(200),
  inviteToken: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().transform((e) => e.toLowerCase()),
  password: z.string(),
});

function login(req: Request, userId: string) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

authRouter.get("/status", async (_req, res) => {
  const users = await prisma.user.count();
  res.json({ needsSetup: users === 0, allowSignup: env.allowSignup });
});

authRouter.get("/invite/:token", async (req, res) => {
  const invite = await prisma.invite.findUnique({ where: { token: param(req, "token") }, include: { project: { select: { name: true } } } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new HttpError(404, "Invite is invalid or expired");
  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  res.json({ email: invite.email, role: invite.role, projectName: invite.project.name, userExists: Boolean(existing) });
});

authRouter.post("/register", async (req, res) => {
  const body = parseBody(registerSchema, req);
  const userCount = await prisma.user.count();
  const invite = body.inviteToken
    ? await prisma.invite.findUnique({ where: { token: body.inviteToken } })
    : null;
  if (body.inviteToken && (!invite || invite.acceptedAt || invite.expiresAt < new Date())) {
    throw new HttpError(400, "Invite is invalid or expired");
  }
  if (userCount > 0 && !invite && !env.allowSignup) {
    throw new HttpError(403, "Sign-up is invite-only. Ask a project owner for an invite link.");
  }
  if (invite && invite.email !== body.email) throw new HttpError(400, `This invite is for ${invite.email}`);
  if (await prisma.user.findUnique({ where: { email: body.email } })) throw new HttpError(409, "An account with this email already exists");

  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash, isAdmin: userCount === 0 } });
    if (invite) {
      await tx.projectMember.create({ data: { projectId: invite.projectId, userId: u.id, role: invite.role } });
      await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    } else {
      await tx.project.create({
        data: { name: userCount === 0 ? "My AI Project" : `${body.name}'s project`, members: { create: { userId: u.id, role: "OWNER" } } },
      });
    }
    return u;
  });
  await login(req, user.id);
  res.status(201).json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin });
});

authRouter.post("/login", async (req, res) => {
  const body = parseBody(loginSchema, req);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) throw new HttpError(401, "Invalid email or password");
  await login(req, user.id);
  res.json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin });
});

/** Accept an invite while signed in (existing account). */
authRouter.post("/invite/:token/accept", requireUser, async (req, res) => {
  const invite = await prisma.invite.findUnique({ where: { token: param(req, "token") } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new HttpError(404, "Invite is invalid or expired");
  if (invite.email !== req.user!.email) throw new HttpError(403, `This invite is for ${invite.email}`);
  await prisma.$transaction([
    prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: invite.projectId, userId: req.user!.id } },
      create: { projectId: invite.projectId, userId: req.user!.id, role: invite.role },
      update: { role: invite.role },
    }),
    prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);
  res.json({ projectId: invite.projectId });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("aieval.sid");
    res.json({ ok: true });
  });
});

authRouter.get("/me", requireUser, async (req, res) => {
  const memberships = await prisma.projectMember.findMany({
    where: { userId: req.user!.id },
    include: { project: { select: { id: true, name: true, description: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ user: req.user, projects: memberships.map((m) => ({ ...m.project, role: m.role })) });
});
