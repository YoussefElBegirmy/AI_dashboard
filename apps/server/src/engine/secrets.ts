import { prisma } from "../db";
import { env } from "../env";
import { decrypt } from "../lib/crypto";

/** Decrypted project secrets, with env-var fallbacks for the well-known keys. */
export async function loadSecrets(projectId: string): Promise<Record<string, string>> {
  const rows = await prisma.secret.findMany({ where: { projectId } });
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env.fallbackSecrets)) if (v) out[k] = v;
  for (const row of rows) {
    try {
      out[row.name] = decrypt(row.value);
    } catch {
      // wrong MASTER_KEY or corrupted value — skip rather than crash the run
    }
  }
  return out;
}

export function requireSecret(secrets: Record<string, string>, name: string): string {
  const v = secrets[name];
  if (!v) throw new Error(`Missing secret "${name}". Add it under Settings → Secrets.`);
  return v;
}
