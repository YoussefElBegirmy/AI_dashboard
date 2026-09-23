import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import session from "express-session";
import { Prisma } from "@prisma/client";
import { ZodError, z } from "zod";
import { env } from "./env";
import { HttpError } from "./lib/http";
import { loadUser, requireProject, requireUser } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { devRouter } from "./routes/dev";
import { mcpRouter } from "./routes/mcp";
import { metricsRouter } from "./routes/metrics";
import { mcpOAuthCallback } from "./routes/mcpOAuthCallback";
import { openRouterRouter } from "./routes/openrouter";
import { projectRouter, projectsRouter } from "./routes/projects";
import { runsRouter } from "./routes/runs";
import { suitesRouter } from "./routes/suites";
import { targetsRouter } from "./routes/targets";
import { v1Router } from "./routes/v1";

const APP_VERSION: string = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).version;

export function createApp(opts: { sessionStore?: session.Store } = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cors({ origin: env.appUrl, credentials: true }));
  app.use(express.json({ limit: "10mb" }));

  const PgStore = connectPgSimple(session);
  app.use(
    session({
      name: "aieval.sid",
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: opts.sessionStore ?? new PgStore({ conString: env.databaseUrl, createTableIfMissing: true }),
      cookie: { httpOnly: true, sameSite: "lax", secure: env.isProd && env.appUrl.startsWith("https"), maxAge: 30 * 24 * 3600_000 },
    }),
  );
  app.use(loadUser);

  app.get("/api/health", (_req, res) => res.json({ ok: true, version: APP_VERSION }));
  app.use("/api/auth", authRouter);
  app.use("/api/openrouter", openRouterRouter);
  app.use("/api/v1", v1Router);
  // OAuth 2.1 redirect target for remote MCP servers (session-authenticated, not project-scoped)
  app.get("/api/mcp-oauth/callback", mcpOAuthCallback);
  app.use("/api/projects", projectsRouter);

  const scoped = express.Router({ mergeParams: true });
  scoped.use(requireUser, requireProject("VIEWER"));
  scoped.use("/targets", targetsRouter);
  scoped.use("/mcp-servers", mcpRouter);
  scoped.use("/suites", suitesRouter);
  scoped.use("/runs", runsRouter);
  scoped.use("/metrics", metricsRouter);
  scoped.use("/", projectRouter);
  app.use("/api/projects/:projectId", scoped);

  if (env.enableDevMocks) app.use("/dev", devRouter);
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

  // Serve the built web app in production.
  const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api|dev).*/, (_req, res) => res.sendFile(resolve(webDist, "index.html")));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err instanceof ZodError) return res.status(400).json({ error: "Validation failed", details: z.flattenError(err) });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") return res.status(409).json({ error: `Already exists (${(err.meta?.target as string[] | undefined)?.join(", ") ?? "unique"})` });
      if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
    }
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
    console.error(err);
    res.status(500).json({ error: "Internal server error", message: env.isProd ? undefined : (err as Error).message });
  };
  app.use(onError);
  return app;
}
