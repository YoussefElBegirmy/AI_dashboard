import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    // API test files share one disposable database and truncate it — run files one at a time.
    fileParallelism: false,
  },
});
