-- Session store table (previously created at runtime by connect-pg-simple).
CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL,
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session"("expire");

-- OAuth 2.1 credentials for remote MCP servers.
ALTER TABLE "McpServer" ADD COLUMN "oauthData" TEXT,
ADD COLUMN "oauthStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN "oauthState" TEXT,
ADD COLUMN "oauthAuthorizedAt" TIMESTAMP(3),
ADD COLUMN "oauthAuthorizedBy" TEXT,
ADD COLUMN "oauthScope" TEXT,
ADD COLUMN "oauthExpiresAt" TIMESTAMP(3),
ADD COLUMN "oauthError" TEXT;

CREATE UNIQUE INDEX "McpServer_oauthState_key" ON "McpServer"("oauthState");
