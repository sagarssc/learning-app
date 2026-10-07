import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import * as gen from "@/lib/ai/generate-cards";
import { prepareText } from "@/lib/ingest";
import { createResource, processNextChunk, retryResource } from "@/lib/pipeline";
import { listCards } from "@/lib/cards";

vi.mock("@/lib/ai/generate-cards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/generate-cards")>();
  return { ...actual, generateCards: vi.fn(actual.generateCards) };
});
const generateCards = vi.mocked(gen.generateCards);
const actualGenerate = generateCards.getMockImplementation()!;

beforeEach(() => {
  generateCards.mockReset();
  generateCards.mockImplementation(actualGenerate); // default: deterministic mock generator
});

let counter = 0;
/** Build text with `sections` heading-separated sections of ~20K chars → one chunk each. */
function makeText(sections: number, topic = "Python", tag = `t${++counter}`) {
  return Array.from({ length: sections }, (_, s) => {
    const body = Array.from(
      { length: 260 },
      (_, i) => `${topic} fact ${tag}-${s}-${i} explains how this ${topic} concept works in everyday projects.`,
    ).join(" ");
    return `## Section ${s} ${tag}\n\n${body}`;
  }).join("\n\n");
}

async function setup(sections: number, topic?: string) {
  const prepared = prepareText(undefined, makeText(sections, topic));
  const created = await createResource(prepared);
  return { ...created, chunks: prepared.chunks.length };
}

async function runToEnd(id: string, max = 20) {
  const results = [];
  for (let i = 0; i < max; i++) {
    const r = (await processNextChunk(id))!;
    results.push(r);
    if (r.finished) break;
  }
  return results;
}

const chunkRows = async (id: string) => {
  const db = await getDb();
  return db
    .select()
    .from(schema.resourceChunks)
    .where(eq(schema.resourceChunks.resourceId, id))
    .orderBy(schema.resourceChunks.idx);
};

describe("createResource", () => {
  it("stores one chunk row per chunk and starts queued", async () => {
    const { id, chunks, duplicate } = await setup(3);
    expect(duplicate).toBe(false);
    expect(chunks).toBe(3);
    const rows = await chunkRows(id);
    expect(rows.map((r) => r.idx)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("detects the same content and returns the existing resource", async () => {
    const text = makeText(1);
    const a = await createResource(prepareText(undefined, text));
    const b = await createResource(prepareText("different title", text));
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
  });
});

describe("processNextChunk — happy path", () => {
  it("processes one chunk per call, reports progress, then finishes ready", async () => {
    const { id } = await setup(3);
    const results = await runToEnd(id);

    expect(results.map((r) => r.chunksDone)).toEqual([1, 2, 3]);
    expect(results.map((r) => r.finished)).toEqual([false, false, true]);
    expect(results.at(-1)!.status).toBe("ready");
    expect(results.every((r) => r.chunksTotal === 3)).toBe(true);

    const { cards } = await listCards({ resourceId: id, limit: 200 });
    expect(cards.length).toBeGreaterThanOrEqual(6);
    expect(cards.every((c) => c.domains.some((d) => d.slug === "python"))).toBe(true);
  });

  it("records the union of card tags on the resource", async () => {
    const { id } = await setup(1, "MySQL");
    await runToEnd(id);
    const db = await getDb();
    const tags = await db
      .select({ slug: schema.domains.slug })
      .from(schema.resourceDomains)
      .innerJoin(schema.domains, eq(schema.domains.id, schema.resourceDomains.domainId))
      .where(eq(schema.resourceDomains.resourceId, id));
    expect(tags.map((t) => t.slug)).toContain("mysql");
  });

  it("passes earlier questions to the generator so it can avoid repeats", async () => {
    const { id } = await setup(2);
    await runToEnd(id);
    const [first, second] = generateCards.mock.calls.map((c) => c[0]);
    expect(first.existingQuestions).toEqual([]);
    expect(second.existingQuestions.length).toBeGreaterThan(0);
  });

  it("is a no-op on an already-finished resource", async () => {
    const { id } = await setup(1);
    await runToEnd(id);
    generateCards.mockClear();
    const again = (await processNextChunk(id))!;
    expect(again.finished).toBe(true);
    expect(generateCards).not.toHaveBeenCalled();
  });

  it("returns null for an unknown resource", async () => {
    expect(await processNextChunk("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("idempotency & concurrency", () => {
  it("re-processing a chunk never duplicates cards", async () => {
    const { id } = await setup(1);
    await runToEnd(id);
    const before = (await listCards({ resourceId: id, limit: 200 })).cards.length;

    // Simulate a crash after cards were stored but before the chunk was marked done.
    const db = await getDb();
    await db.update(schema.resourceChunks).set({ status: "pending" }).where(eq(schema.resourceChunks.resourceId, id));
    await db.update(schema.resources).set({ status: "queued" }).where(eq(schema.resources.id, id));
    await runToEnd(id);

    expect((await listCards({ resourceId: id, limit: 200 })).cards).toHaveLength(before);
  });

  it("two simultaneous calls on a one-chunk resource generate it only once", async () => {
    const { id } = await setup(1);
    const [a, b] = await Promise.all([processNextChunk(id), processNextChunk(id)]);
    expect(generateCards).toHaveBeenCalledTimes(1);
    expect([a!.busy, b!.busy].filter(Boolean).length + [a!.finished, b!.finished].filter(Boolean).length).toBeGreaterThanOrEqual(2);
    const { cards } = await listCards({ resourceId: id, limit: 200 });
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it("does not steal a chunk that another request claimed moments ago", async () => {
    const { id } = await setup(1);
    const db = await getDb();
    await db.update(schema.resourceChunks).set({ status: "processing", claimedAt: new Date() }).where(eq(schema.resourceChunks.resourceId, id));
    const r = (await processNextChunk(id))!;
    expect(r.busy).toBe(true);
    expect(r.finished).toBe(false);
    expect(generateCards).not.toHaveBeenCalled();
  });

  it("reclaims a chunk whose claim went stale (tab closed mid-run)", async () => {
    const { id } = await setup(1);
    const db = await getDb();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await db.update(schema.resourceChunks).set({ status: "processing", claimedAt: tenMinutesAgo }).where(eq(schema.resourceChunks.resourceId, id));
    const results = await runToEnd(id);
    expect(results.at(-1)!.status).toBe("ready");
    expect(generateCards).toHaveBeenCalledTimes(1);
  });
});

describe("failure handling", () => {
  it("skips a section the model refuses and still finishes the rest", async () => {
    const { id } = await setup(3);
    generateCards.mockImplementationOnce(async () => {
      throw new gen.RefusalError("declined");
    });
    const results = await runToEnd(id);
    const rows = await chunkRows(id);
    expect(rows.map((r) => r.status)).toEqual(["skipped", "done", "done"]);
    expect(results.at(-1)!.status).toBe("ready");
    expect(results.at(-1)!.chunksDone).toBe(3); // skipped counts as handled
  });

  it("marks the resource failed when every section is refused", async () => {
    const { id } = await setup(2);
    generateCards.mockImplementation(async () => {
      throw new gen.RefusalError("declined");
    });
    const results = await runToEnd(id);
    expect(results.at(-1)!.status).toBe("failed");
    expect(results.at(-1)!.error).toMatch(/No cards/);
  });

  it("keeps the chunk queued after a retryable error, then succeeds on the next call", async () => {
    const { id } = await setup(1);
    generateCards.mockImplementationOnce(async () => {
      throw new gen.GenerationError("Rate limited", true);
    });
    const first = (await processNextChunk(id))!;
    expect(first.error).toBe("Rate limited");
    expect(first.finished).toBe(false);
    expect(first.status).toBe("processing");
    expect((await chunkRows(id))[0].status).toBe("pending");

    const results = await runToEnd(id);
    expect(results.at(-1)!.status).toBe("ready");
    expect(results.at(-1)!.error).toBeUndefined();
  });

  it("fails permanently on a non-retryable error and recovers via retryResource", async () => {
    const { id } = await setup(1);
    generateCards.mockImplementationOnce(async () => {
      throw new gen.GenerationError("Claude rejected the API key", false);
    });
    const failed = (await processNextChunk(id))!;
    expect(failed.status).toBe("failed");
    expect(failed.finished).toBe(true);

    // While failed, further calls don't hammer the API.
    generateCards.mockClear();
    await processNextChunk(id);
    expect(generateCards).not.toHaveBeenCalled();

    expect(await retryResource(id)).toBe(true);
    const results = await runToEnd(id);
    expect(results.at(-1)!.status).toBe("ready");
  });

  it("retryResource re-queues skipped sections but keeps finished ones", async () => {
    const { id } = await setup(2);
    generateCards.mockImplementationOnce(async () => {
      throw new gen.RefusalError("declined");
    });
    await runToEnd(id);
    expect((await chunkRows(id)).map((r) => r.status)).toEqual(["skipped", "done"]);

    await retryResource(id);
    expect((await chunkRows(id)).map((r) => r.status)).toEqual(["pending", "done"]);
    generateCards.mockClear();
    await runToEnd(id);
    expect(generateCards).toHaveBeenCalledTimes(1);
  });
});

describe("sanitize (model output validation)", () => {
  const domains = [
    { slug: "python", name: "Python", description: "" },
    { slug: "llm", name: "LLM", description: "" },
  ];
  const card = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
  const base = () => ({
    kind: "qa" as "qa" | "note",
    question: "What is a generator?" as string | null,
    body: "A lazy iterator.",
    domains: ["python"],
    source_ref: null as string | null,
  });

  it("drops empty bodies, questionless qa cards, and unknown domain slugs", () => {
    const out = gen.sanitize(
      {
        cards: [
          card({ body: "   " }),
          card({ question: " " }),
          card({ question: "Valid one?", domains: ["python", "cobol", "llm"] }),
        ],
        suggested_new_domains: [],
      },
      domains,
      [],
      "p. 3",
    );
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].domainSlugs).toEqual(["python", "llm"]);
    expect(out.cards[0].sourceRef).toBe("p. 3"); // falls back to the chunk's location
  });

  it("dedupes against existing and within-batch questions, ignoring case/punctuation", () => {
    const out = gen.sanitize(
      {
        cards: [
          card({ question: "WHAT is a generator" }),
          card({ question: "What is an iterator?" }),
          card({ question: "What is an iterator" }),
        ],
        suggested_new_domains: [],
      },
      domains,
      ["What is a generator?"],
      null,
    );
    expect(out.cards.map((c) => c.question)).toEqual(["What is an iterator?"]);
  });

  it("maps display names and odd casing to slugs instead of dropping the tag", () => {
    const out = gen.sanitize(
      { cards: [card({ domains: [" PYTHON ", "llm", "Python"] })], suggested_new_domains: [] },
      [...domains, { slug: "node", name: "Node.js", description: "" }],
      [],
      null,
    );
    expect(out.cards[0].domainSlugs).toEqual(["python", "llm"]);

    const byName = gen.sanitize(
      { cards: [card({ question: "Q2?", domains: ["Node.js"] })], suggested_new_domains: [] },
      [{ slug: "node", name: "Node.js", description: "" }],
      [],
      null,
    );
    expect(byName.cards[0].domainSlugs).toEqual(["node"]);
  });

  it("normalizes the card kind and drops cards whose kind is unrecognisable", () => {
    const out = gen.sanitize(
      {
        cards: [
          card({ kind: "Q&A" as never, question: "One?" }),
          card({ kind: " NOTE " as never, question: null, body: "A note" }),
          card({ kind: "flashcard" as never, question: "Two?" }),
        ],
        suggested_new_domains: [],
      },
      domains,
      [],
      null,
    );
    expect(out.cards.map((c) => c.kind)).toEqual(["qa", "note"]);
  });

  it("the schema tolerates off-spec values (one bad slug must not fail a whole section)", () => {
    const schema = gen.outputSchema(["python", "llm"]);
    const parsed = schema.safeParse({
      cards: [{ kind: "qa", question: "q", body: "b", domains: ["python", "made-up"], source_ref: null }],
      suggested_new_domains: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("spells the allowed slugs out in the schema sent to Claude", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const sent = JSON.stringify(zodOutputFormat(gen.outputSchema(["python", "llm"])).schema);
    expect(sent).toContain("each exactly one of: python, llm");
    expect(sent).toContain('"additionalProperties":false');
  });

  it("nulls the question on notes and caps the domain list at three", () => {
    const out = gen.sanitize(
      { cards: [card({ kind: "note", question: "ignored?", domains: ["python", "llm", "python"] })], suggested_new_domains: [] },
      domains,
      [],
      null,
    );
    expect(out.cards[0].question).toBeNull();
    expect(out.cards[0].domainSlugs).toEqual(["python", "llm"]);
  });

  it("suggests new domains only when they aren't already known", () => {
    const out = gen.sanitize(
      { cards: [], suggested_new_domains: ["Kubernetes", "python", "LLM", "  Kubernetes ", "Rust"] },
      domains,
      [],
      null,
    );
    expect(out.suggestedDomains).toEqual(["Kubernetes", "Rust"]);
  });
});

describe("a failed claim must not leak between resources", () => {
  it("only claims chunks belonging to the requested resource", async () => {
    const a = await setup(1);
    const b = await setup(1);
    await runToEnd(a.id);
    const db = await getDb();
    const bRows = await db.select().from(schema.resourceChunks).where(and(eq(schema.resourceChunks.resourceId, b.id)));
    expect(bRows.every((r) => r.status === "pending")).toBe(true);
  });
});
