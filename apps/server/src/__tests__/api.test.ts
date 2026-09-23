/**
 * API integration tests. They need a disposable Postgres database:
 *   TEST_DATABASE_URL=postgresql://aieval:aieval@localhost:5432/aieval_test npm test -w @aieval/server
 * (create it once and run `prisma migrate deploy` against it — see README). Skipped otherwise.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import session from "express-session";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("API", () => {
  let server: Server;
  let base: string;
  let prisma: typeof import("../db").prisma;
  let owner: ReturnType<typeof request.agent>;
  let viewer: ReturnType<typeof request.agent>;
  let projectId = "";

  beforeAll(async () => {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL === TEST_DB) {
      throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL — the API tests wipe the database.");
    }
    process.env.DATABASE_URL = TEST_DB;
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.MASTER_KEY = "test-master-key";
    ({ prisma } = await import("../db"));
    // clean slate
    await prisma.$executeRawUnsafe(
      `TRUNCATE "EvaluationResult","RunResult","Run","TestCase","Suite","McpServer","Target","Secret","ApiToken","Invite","ProjectMember","Project","User" CASCADE`,
    );
    const { createApp } = await import("../app");
    const app = createApp({ sessionStore: new session.MemoryStore() });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // agents keep session cookies between requests
    owner = request.agent(base);
    viewer = request.agent(base);
  });

  afterAll(async () => {
    server?.close();
    await prisma?.$disconnect();
  });

  it("first user sets up the workspace; later sign-ups need an invite", async () => {
    const status = await request(base).get("/api/auth/status");
    expect(status.body.needsSetup).toBe(true);

    const res = await owner.post("/api/auth/register").send({ email: "Owner@Example.com", name: "Owner", password: "password123" });
    expect(res.status).toBe(201);
    expect(res.body.isAdmin).toBe(true);

    const me = await owner.get("/api/auth/me");
    expect(me.body.user.email).toBe("owner@example.com");
    projectId = me.body.projects[0].id;
    expect(me.body.projects[0].role).toBe("OWNER");

    const blocked = await request(base).post("/api/auth/register").send({ email: "x@example.com", name: "X", password: "password123" });
    expect(blocked.status).toBe(403);
  });

  it("invites a viewer who cannot edit", async () => {
    const inv = await owner.post(`/api/projects/${projectId}/members`).send({ email: "viewer@example.com", role: "VIEWER" });
    expect(inv.status).toBe(201);
    const token = new URL(inv.body.invite.link).searchParams.get("invite");

    const reg = await viewer.post("/api/auth/register").send({ email: "viewer@example.com", name: "Viewer", password: "password123", inviteToken: token });
    expect(reg.status).toBe(201);

    const list = await viewer.get(`/api/projects/${projectId}/targets`);
    expect(list.status).toBe(200);
    const create = await viewer.post(`/api/projects/${projectId}/targets`).send({ name: "x", kind: "HTTP_ENDPOINT", config: { url: "http://x" } });
    expect(create.status).toBe(403);
  });

  it("rejects unauthenticated access to project data", async () => {
    const res = await request(base).get(`/api/projects/${projectId}/targets`);
    expect(res.status).toBe(401);
  });

  it("stores secrets encrypted and never returns the value", async () => {
    const put = await owner.put(`/api/projects/${projectId}/secrets/MY_KEY`).send({ value: "super-secret-value-123" });
    expect(put.status).toBe(200);
    const list = await owner.get(`/api/projects/${projectId}/secrets`);
    expect(JSON.stringify(list.body)).not.toContain("super-secret-value-123");
    expect(list.body.secrets[0].preview).toBe("supe…-123");
    const row = await prisma.secret.findFirstOrThrow({ where: { projectId, name: "MY_KEY" } });
    expect(row.value).not.toContain("super-secret");
  });

  it("validates target configs", async () => {
    const bad = await owner.post(`/api/projects/${projectId}/targets`).send({ name: "bad", kind: "OPENROUTER_MODEL", config: {} });
    expect(bad.status).toBe(400);
  });

  it("runs a suite end-to-end against an HTTP target and computes metrics", async () => {
    const target = await owner.post(`/api/projects/${projectId}/targets`).send({
      name: "Mock QA",
      kind: "HTTP_ENDPOINT",
      config: { url: `${base}/dev/mock/qa`, headers: { "Content-Type": "application/json", "X-Key": "{{secrets.MY_KEY}}" }, body: { question: "{{input.question}}" }, outputPath: "$.answer" },
    });
    expect(target.status).toBe(201);

    const suite = await owner.post(`/api/projects/${projectId}/suites`).send({
      name: "Capitals",
      evaluators: [{ id: "c", name: "Has city", type: "contains", value: "{{expected.city}}", caseInsensitive: true }],
    });
    expect(suite.status).toBe(201);
    const imp = await owner.post(`/api/projects/${projectId}/suites/${suite.body.id}/cases/import`).send({
      cases: [
        { name: "France", input: { question: "capital of France" }, expected: { city: "Paris" }, tags: ["eu"] },
        { name: "Australia", input: { question: "capital of Australia" }, expected: { city: "Canberra" } },
      ],
    });
    expect(imp.body.imported).toBe(2);

    const run = await owner.post(`/api/projects/${projectId}/suites/${suite.body.id}/runs`).send({ targetIds: [target.body.id] });
    expect(run.status).toBe(201);

    let detail;
    for (let i = 0; i < 50; i++) {
      detail = await owner.get(`/api/projects/${projectId}/runs/${run.body.id}`);
      if (detail.body.status === "COMPLETED" || detail.body.status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(detail!.body.status).toBe("COMPLETED");
    expect(detail!.body.passed).toBe(1);
    expect(detail!.body.failed).toBe(1);
    const aus = detail!.body.results.find((r: { caseName: string }) => r.caseName === "Australia");
    expect(aus.status).toBe("FAIL");
    expect(aus.evaluations[0].reasoning).toMatch(/Canberra/);

    // human override flips the effective verdict
    const review = await owner.post(`/api/projects/${projectId}/runs/${run.body.id}/results/${aus.id}/review`).send({ status: "PASS", note: "accepted" });
    expect(review.body.humanStatus).toBe("PASS");

    const metrics = await owner.get(`/api/projects/${projectId}/metrics?days=7`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.kpis.results).toBe(2);
    expect(metrics.body.kpis.passRate).toBe(1);
    expect(metrics.body.byTarget[0].targetName).toBe("Mock QA");
    expect(metrics.body.tags[0]).toMatchObject({ tag: "eu", passRate: 1 });

    const cmp = await owner.get(`/api/projects/${projectId}/runs/compare?base=${run.body.id}&head=${run.body.id}`);
    expect(cmp.body.summary.same).toBe(2);
  });

  it("lets CI trigger runs with an API token", async () => {
    const tok = await owner.post(`/api/projects/${projectId}/tokens`).send({ name: "ci" });
    expect(tok.body.token).toMatch(/^aie_/);
    const suites = await owner.get(`/api/projects/${projectId}/suites`);
    const suite = suites.body[0];
    const targets = await owner.get(`/api/projects/${projectId}/targets`);
    const res = await request(base)
      .post(`/api/v1/suites/${suite.id}/runs`)
      .set("Authorization", `Bearer ${tok.body.token}`)
      .send({ targetIds: [targets.body[0].id] });
    expect(res.status).toBe(201);
    const status = await request(base).get(`/api/v1/runs/${res.body.id}`).set("Authorization", `Bearer ${tok.body.token}`);
    expect(status.status).toBe(200);
    expect(status.body).toHaveProperty("finished");

    const wrong = await request(base).get(`/api/v1/runs/${res.body.id}`).set("Authorization", "Bearer aie_nope");
    expect(wrong.status).toBe(401);
  });
});
