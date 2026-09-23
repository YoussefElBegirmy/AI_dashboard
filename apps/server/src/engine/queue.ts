import PgBoss from "pg-boss";
import { prisma } from "../db";
import { env } from "../env";
import { executeRun } from "./worker";

const QUEUE = "run-suite";
const WORKERS = 3;
let boss: PgBoss | null = null;

export async function startQueue() {
  // Runs that were mid-flight when the server stopped cannot be resumed.
  await prisma.run.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED", error: "Server restarted while the run was in progress", finishedAt: new Date() },
  });
  boss = new PgBoss({ connectionString: env.databaseUrl, schema: "pgboss" });
  boss.on("error", (err) => console.error("[queue]", err));
  await boss.start();
  await boss.createQueue(QUEUE);
  for (let i = 0; i < WORKERS; i++) {
    await boss.work<{ runId: string }>(QUEUE, { pollingIntervalSeconds: 1 }, async ([job]) => {
      await executeRun(job.data.runId);
    });
  }
  // Re-enqueue runs left QUEUED (e.g. created while the queue was down).
  const queued = await prisma.run.findMany({ where: { status: "QUEUED" }, select: { id: true } });
  for (const r of queued) await enqueueRun(r.id);
}

export async function enqueueRun(runId: string) {
  if (!boss) {
    // Queue not started (tests / scripts): execute in-process.
    setImmediate(() => void executeRun(runId));
    return;
  }
  await boss.send(QUEUE, { runId }, { retryLimit: 0, expireInHours: 12, singletonKey: runId });
}

export async function stopQueue() {
  await boss?.stop({ graceful: true, timeout: 10_000 });
  boss = null;
}
