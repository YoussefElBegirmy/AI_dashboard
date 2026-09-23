import "./env";
import { createApp } from "./app";
import { prisma } from "./db";
import { mcpManager } from "./engine/mcp/manager";
import { startQueue, stopQueue } from "./engine/queue";
import { env } from "./env";

async function main() {
  await prisma.$connect();
  await startQueue();
  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] API listening on http://localhost:${env.port}`);
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[server] ${signal} received, shutting down…`);
    server.close();
    await Promise.allSettled([stopQueue(), mcpManager.closeAll()]);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
