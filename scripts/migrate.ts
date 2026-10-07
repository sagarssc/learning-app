// Applies migrations (and seeds default domains) to the database in DATABASE_URL.
// Usage: npm run db:migrate
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(
      "DATABASE_URL is not set. Local dev (PGlite) migrates automatically on first request — nothing to do.",
    );
    return;
  }

  const { neon } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-http");
  const { migrate } = await import("drizzle-orm/neon-http/migrator");
  const { seedDomains } = await import("../src/db/seed");
  const schema = await import("../src/db/schema");

  const db = drizzle(neon(url), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await seedDomains(db as any);
  console.log("Migrations applied and default domains seeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
