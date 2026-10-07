import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listCards, setCardDomains } from "@/lib/cards";
import { seedDemoDeck } from "@/lib/demo";
import { dedupeKey, normalizeForDedupe } from "@/lib/dedupe";

beforeAll(async () => {
  const { inserted } = await seedDemoDeck();
  expect(inserted).toBe(12);
});

const slugsOf = (c: { domains: { slug: string }[] }) => c.domains.map((d) => d.slug);

describe("seeding", () => {
  it("is idempotent — a second run inserts nothing", async () => {
    const { inserted } = await seedDemoDeck();
    expect(inserted).toBe(0);
    expect((await listCards({ limit: 200 })).cards).toHaveLength(12);
  });
});

describe("listCards — filtering", () => {
  it("returns every card with its domain tags attached", async () => {
    const { cards } = await listCards({ limit: 200 });
    expect(cards).toHaveLength(12);
    expect(cards.every((c) => c.domains.length >= 1)).toBe(true);
    const rag = cards.find((c) => c.body.includes("Retrieval-Augmented"))!;
    expect(slugsOf(rag).sort()).toEqual(["ai-engineering", "llm"]);
  });

  it("filters by a single domain", async () => {
    const { cards } = await listCards({ domainSlugs: ["python"], limit: 200 });
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => slugsOf(c).includes("python"))).toBe(true);
  });

  it("multi-domain filter is any-of and never duplicates a card tagged with both", async () => {
    const { cards } = await listCards({ domainSlugs: ["ai-engineering", "llm"], limit: 200 });
    const ids = cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cards).toHaveLength(3); // RAG (both), prompt caching (both), positional encodings (llm)
  });

  it("filtering by a domain keeps ALL of a card's tags, not just the matched one", async () => {
    const { cards } = await listCards({ domainSlugs: ["hld"], limit: 200 });
    const rr = cards.find((c) => c.question?.includes("REPEATABLE READ"))!;
    expect(slugsOf(rr).sort()).toEqual(["hld", "mysql"]);
  });

  it("unknown domain yields nothing", async () => {
    expect((await listCards({ domainSlugs: ["cobol"] })).cards).toHaveLength(0);
  });
});

describe("listCards — ordering & paging", () => {
  it("sequential mode keeps document order within a resource", async () => {
    const { cards } = await listCards({ mode: "seq", limit: 200 });
    expect(cards[0].question).toMatch(/list and a tuple/);
    expect(cards[1].question).toMatch(/event loop/);
  });

  it("pages concatenate to the full list without gaps or repeats", async () => {
    const full = (await listCards({ mode: "seq", limit: 200 })).cards.map((c) => c.id);
    const paged: string[] = [];
    let offset = 0;
    for (;;) {
      const page = await listCards({ mode: "seq", limit: 5, offset });
      paged.push(...page.cards.map((c) => c.id));
      if (!page.hasMore) break;
      offset += 5;
    }
    expect(paged).toEqual(full);
  });

  it("shuffle with the same seed is stable across calls and across page boundaries", async () => {
    const a = (await listCards({ mode: "shuffle", seed: "abc", limit: 200 })).cards.map((c) => c.id);
    const b = (await listCards({ mode: "shuffle", seed: "abc", limit: 200 })).cards.map((c) => c.id);
    expect(a).toEqual(b);

    const p1 = await listCards({ mode: "shuffle", seed: "abc", limit: 7, offset: 0 });
    const p2 = await listCards({ mode: "shuffle", seed: "abc", limit: 7, offset: 7 });
    expect([...p1.cards, ...p2.cards].map((c) => c.id)).toEqual(a);
    expect(p1.hasMore).toBe(true);
    expect(p2.hasMore).toBe(false);
  });

  it("a different shuffle seed gives a different order", async () => {
    const a = (await listCards({ mode: "shuffle", seed: "abc", limit: 200 })).cards.map((c) => c.id);
    const b = (await listCards({ mode: "shuffle", seed: "xyz", limit: 200 })).cards.map((c) => c.id);
    expect(a).not.toEqual(b);
    expect([...a].sort()).toEqual([...b].sort());
  });
});

describe("tag editing & starring", () => {
  it("setCardDomains replaces tags, ignoring unknown ids", async () => {
    const db = await getDb();
    const { cards } = await listCards({ domainSlugs: ["lld"], limit: 1 });
    const card = cards[0];
    const [py] = await db.select().from(schema.domains).where(eq(schema.domains.slug, "python"));

    await setCardDomains(card.id, [py.id, "00000000-0000-4000-8000-000000000000"]);
    const after = (await listCards({ domainSlugs: ["python"], limit: 200 })).cards.find((c) => c.id === card.id)!;
    expect(slugsOf(after)).toEqual(["python"]);
  });

  it("starred filter returns only starred cards", async () => {
    const db = await getDb();
    const { cards } = await listCards({ limit: 1 });
    await db.update(schema.cards).set({ starred: true }).where(eq(schema.cards.id, cards[0].id));
    const starred = await listCards({ starred: true });
    expect(starred.cards.map((c) => c.id)).toEqual([cards[0].id]);
  });
});

describe("dedupe keys", () => {
  it("treats cosmetic differences as the same question", () => {
    const a = dedupeKey({ question: "What is a `generator` in Python?", body: "x" });
    const b = dedupeKey({ question: "what is a generator in python", body: "y" });
    expect(a).toBe(b);
  });

  it("notes dedupe on body; different bodies differ", () => {
    expect(dedupeKey({ question: null, body: "Alpha note" })).not.toBe(
      dedupeKey({ question: null, body: "Beta note" }),
    );
  });

  it("normalization keeps non-latin letters", () => {
    expect(normalizeForDedupe("  Привет,  МИР! ")).toBe("привет мир");
  });
});
