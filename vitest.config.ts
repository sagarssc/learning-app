import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Each test file gets its own in-memory Postgres (see src/db/index.ts). DATABASE_URL is
    // forced empty so a real database URL in the shell or .env.local can NEVER be used by tests —
    // they delete and merge domains.
    env: { PGLITE_DIR: "memory://", MOCK_LLM: "1", DATABASE_URL: "", ANTHROPIC_API_KEY: "" },
  },
});
