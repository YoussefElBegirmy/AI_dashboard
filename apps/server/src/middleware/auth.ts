import type { NextFunction, Request, Response } from "express";
import { ROLE_RANK, type Role } from "@aieval/shared";
import { prisma } from "../db";
import { sha256 } from "../lib/crypto";
import { HttpError, param } from "../lib/http";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Set when authenticated with an API token (scoped to one project). */
      tokenProjectId?: string;
      member?: { projectId: string; role: Role };
    }
  }
}

const userSelect = { id: true, email: true, name: true, isAdmin: true } as const;

/** Resolves the user from the session cookie or an `Authorization: Bearer aie_…` token. */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = await prisma.apiToken.findUnique({
      where: { tokenHash: sha256(header.slice(7).trim()) },
      include: { user: { select: userSelect } },
    });
    if (!token) return next(new HttpError(401, "Invalid API token"));
    req.user = token.user;
    req.tokenProjectId = token.projectId;
    prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return next();
  }
  if (req.session?.userId) {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId }, select: userSelect });
    if (user) req.user = user;
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Not signed in"));
  next();
}

/** Must be mounted on a router whose path contains `:projectId`. */
export function requireProject(minRole: Role = "VIEWER") {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Not signed in"));
    const projectId = param(req, "projectId");
    if (req.tokenProjectId && req.tokenProjectId !== projectId) {
      return next(new HttpError(403, "API token is not valid for this project"));
    }
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: req.user.id } },
    });
    if (!membership) return next(new HttpError(404, "Project not found"));
    if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      return next(new HttpError(403, `Requires ${minRole.toLowerCase()} role`));
    }
    req.member = { projectId, role: membership.role };
    next();
  };
}

/** Inline role check for handlers mounted with a lower base role. */
export function assertRole(req: Request, minRole: Role) {
  if (!req.member || ROLE_RANK[req.member.role] < ROLE_RANK[minRole]) {
    throw new HttpError(403, `Requires ${minRole.toLowerCase()} role`);
  }
}

export function projectId(req: Request): string {
  if (!req.member) throw new HttpError(500, "Project context missing");
  return req.member.projectId;
}
