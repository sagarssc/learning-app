import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { prepareText } from "@/lib/ingest";
import { listCards } from "@/lib/cards";
import { createResource, processNextChunk } from "@/lib/pipeline";
import { deleteResource, dismissSuggestedDomain, getResource, listResources } from "@/lib/resources";

let n = 0;
async function makeReadyResource(topic = "MySQL") {
  const text = `## ${topic} notes ${++n}\n\n${Array.from(
    { length: 12 },
    (_, i) => `${topic} statement ${n}-${i} describes how ${topic} handles indexes and transactions in production.`,
  ).join(" ")}`;
  const { id } = await createResource(prepareText(undefined, text));
  for (let i = 0; i < 5; i++) if ((await processNextChunk(id))!.finished) break;
  return id;
}

describe("listResources", () => {
  it("reports each resource's real card count (regression: subquery used to match nothing)", async () => {
    const id = await makeReadyResource();
    const actual = (await listCards({ resourceId: id, limit: 200 })).cards.length;
    expect(actual).toBeGreaterThan(0);

    const dto = (await getResource(id))!;
    expect(dto.cardCount).toBe(actual);
    expect(dto.status).toBe("ready");
  });

  it("gives different resources their own counts, newest first, with tags", async () => {
    const a = await makeReadyResource("Python");
    const b = await makeReadyResource("MySQL");
    const list = await listResources();
    const ia = list.findIndex((r) => r.id === a);
    const ib = list.findIndex((r) => r.id === b);
    expect(ib).toBeLessThan(ia); // b was created later
    expect(list[ia].domains.map((d) => d.slug)).toContain("python");
    expect(list[ib].domains.map((d) => d.slug)).toContain("mysql");
    expect(list[ia].cardCount).toBe((await listCards({ resourceId: a, limit: 200 })).cards.length);
  });

  it("returns null for an unknown id", async () => {
    expect(await getResource("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("deleteResource", () => {
  it("removes the resource along with its cards, chunks and tags", async () => {
    const id = await makeReadyResource();
    expect((await listCards({ resourceId: id })).cards.length).toBeGreaterThan(0);

    expect(await deleteResource(id)).toBe(true);

    const db = await getDb();
    expect(await getResource(id)).toBeNull();
    expect((await listCards({ resourceId: id })).cards).toHaveLength(0);
    expect(await db.select().from(schema.resourceChunks).where(eq(schema.resourceChunks.resourceId, id))).toHaveLength(0);
    expect(await db.select().from(schema.resourceDomains).where(eq(schema.resourceDomains.resourceId, id))).toHaveLength(0);
    expect(await deleteResource(id)).toBe(false);
  });
});

describe("dismissSuggestedDomain", () => {
  it("removes just the named suggestion, case-insensitively", async () => {
    const id = await makeReadyResource();
    const db = await getDb();
    await db.update(schema.resources).set({ suggestedDomains: ["Kubernetes", "Rust"] }).where(eq(schema.resources.id, id));

    expect(await dismissSuggestedDomain(id, "kubernetes")).toBe(true);
    expect((await getResource(id))!.suggestedDomains).toEqual(["Rust"]);
    expect(await dismissSuggestedDomain("00000000-0000-4000-8000-000000000000", "x")).toBe(false);
  });
});
