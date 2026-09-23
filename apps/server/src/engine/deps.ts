import { prisma } from "../db";
import { callJev } from "./evaluators/jev";
import { mcpManager } from "./mcp/manager";
import type { EngineDeps } from "./types";

/** Production wiring of the engine to Postgres, MCP and the network. */
export const engineDeps: EngineDeps = {
  mcp: mcpManager,
  loadTarget: (projectId, id) => prisma.target.findFirst({ where: { id, projectId } }),
  loadMcpServer: (projectId, id) => prisma.mcpServer.findFirst({ where: { id, projectId } }),
  fetch: (...args) => fetch(...args),
};

export const evalTransport = { jev: callJev, fetch: (...args: Parameters<typeof fetch>) => fetch(...args) };
