import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listCards } from "@/lib/cards";
import { deleteDomain, mergeDomains, updateDomain } from "@/lib/domains";
import { seedDemoDeck } from "@/lib/demo";

async function domainId(slug: string) {
  const db = await getDb();
  const [d] = await db.select().from(schema.domains).where(eq(schema.domains.slug, slug));
  return d.id;
}

describe("domain management", () => {
  it("updates name/color/description but keeps the slug stable", async () => {
    const id = await domainId("node");
    expect(await updateDomain(id, { name: "Node / JS", color: "#112233", description: "Backend JS" })).toBe(true);
    const db = await getDb();
    const [d] = await db.select().from(schema.domains).where(eq(schema.domains.id, id));
    expect(d).toMatchObject({ slug: "node", name: "Node / JS", color: "#112233", description: "Backend JS" });
  });

  it("reports false for unknown domains", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    expect(await updateDomain(ghost, { name: "x" })).toBe(false);
    expect(await updateDomain(ghost, {})).toBe(false);
    expect(await deleteDomain(ghost)).toBe(false);
    expect(await mergeDomains(ghost, await domainId("python"))).toBe(false);
  });

  it("merging moves tags without duplicating them, then removes the source", async () => {
    await seedDemoDeck();
    const llm = await domainId("llm");
    const ai = await domainId("ai-engineering");

    const beforeLlm = (await listCards({ domainSlugs: ["llm"], limit: 200 })).cards.map((c) => c.id);
    const beforeAi = (await listCards({ domainSlugs: ["ai-engineering"], limit: 200 })).cards.map((c) => c.id);
    expect(beforeLlm.length).toBeGreaterThan(0);
    const bothBefore = beforeLlm.filter((id) => beforeAi.includes(id));
    expect(bothBefore.length).toBeGreaterThan(0); // the demo has cards tagged with both

    expect(await mergeDomains(llm, ai)).toBe(true);

    const merged = (await listCards({ domainSlugs: ["ai-engineering"], limit: 200 })).cards;
    expect(new Set(merged.map((c) => c.id))).toEqual(new Set([...beforeAi, ...beforeLlm]));
    for (const card of merged) {
      const slugs = card.domains.map((d) => d.slug);
      expect(slugs).not.toContain("llm");
      expect(new Set(slugs).size).toBe(slugs.length); // no duplicate tag on cards that had both
    }
    expect((await listCards({ domainSlugs: ["llm"] })).cards).toHaveLength(0);
  });

  it("refuses to merge a domain into itself", async () => {
    const id = await domainId("python");
    expect(await mergeDomains(id, id)).toBe(false);
    expect(await domainId("python")).toBe(id);
  });

  it("deleting a domain untags cards but keeps the cards", async () => {
    const total = (await listCards({ limit: 200 })).cards.length;
    const mysql = await domainId("mysql");
    expect(await deleteDomain(mysql)).toBe(true);

    const after = (await listCards({ limit: 200 })).cards;
    expect(after).toHaveLength(total);
    expect(after.every((c) => c.domains.every((d) => d.slug !== "mysql"))).toBe(true);
  });
});
