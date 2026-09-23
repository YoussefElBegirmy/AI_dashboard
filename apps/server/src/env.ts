import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../../.env");
if (existsSync(rootEnv) && !process.env.VITEST) process.loadEnvFile(rootEnv);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  return v;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  port: Number(process.env.PORT ?? 3001),
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get masterKey() {
    return required("MASTER_KEY");
  },
  allowSignup: process.env.ALLOW_SIGNUP === "true",
  enableDevMocks: process.env.ENABLE_DEV_MOCKS !== "false",
  isProd: process.env.NODE_ENV === "production",
  fallbackSecrets: {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
    TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY ?? "",
  } as Record<string, string>,
};
