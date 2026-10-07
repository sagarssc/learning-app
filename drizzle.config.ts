import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only needs the schema. DATABASE_URL is used by
// `drizzle-kit studio`; migrations are applied by scripts/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
