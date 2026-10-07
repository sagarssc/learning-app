import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// One connection promise per process (survives Next.js dev hot-reloads, which
// matters for PGlite: two instances must never open the same data dir).
const g = globalThis as unknown as { __learningDb?: Promise<Db> };

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;

  if (url) {
    // Production / hosted: Neon over HTTP. Stateless, so no transactions —
    // writes elsewhere in the app are designed to be idempotent instead.
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    return drizzle(neon(url), { schema }) as unknown as Db;
  }

  // The embedded database is for local dev & tests. In production it can't work (serverless
  // filesystems are ephemeral), so fail with a useful message unless it was asked for explicitly.
  if (process.env.NODE_ENV === "production" && !process.env.PGLITE_DIR) {
    throw new Error("DATABASE_URL is not set. Add your Neon Postgres connection string to the environment variables.");
  }

  // Local dev & tests: embedded Postgres, no account or install needed.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { seedDomains } = await import("./seed");

  const dataDir = process.env.PGLITE_DIR ?? ".data/pglite";
  // PGlite creates only the last path segment, so make sure parents exist (skip for memory://).
  if (!dataDir.includes("://")) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await seedDomains(db as unknown as Db);
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  if (!g.__learningDb) {
    // Don't cache a failed connection: clear it so the next request retries.
    g.__learningDb = connect().catch((err) => {
      g.__learningDb = undefined;
      throw err;
    });
  }
  return g.__learningDb;
}

export { schema };
