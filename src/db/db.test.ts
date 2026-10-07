import { describe, expect, it } from "vitest";
import { getDb, schema } from "./index";
import { seedDomains } from "./seed";

describe("local database", () => {
  it("migrates and seeds the default domains", async () => {
    const db = await getDb();
    const rows = await db.select().from(schema.domains);
    expect(rows.map((d) => d.slug).sort()).toEqual(
      ["ai-engineering", "hld", "lld", "llm", "mysql", "node", "python"],
    );
  });

  it("seeding twice does not duplicate domains", async () => {
    const db = await getDb();
    await seedDomains(db);
    const rows = await db.select().from(schema.domains);
    expect(rows).toHaveLength(7);
  });
});
