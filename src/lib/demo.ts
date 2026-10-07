import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { insertCards, type NewCard } from "@/lib/card-store";
import { contentHash } from "@/lib/dedupe";

const DEMO: NewCard[] = [
  {
    kind: "qa",
    question: "What is the difference between a list and a tuple in Python?",
    body: "Lists are **mutable**; tuples are **immutable**.\n\n- Tuples are hashable (if their items are), so they can be dict keys / set members\n- Tuples signal fixed-size records; lists signal homogeneous collections\n- Tuples are slightly faster and smaller",
    domainSlugs: ["python"],
    sourceRef: "Data structures",
  },
  {
    kind: "qa",
    question: "How does the Node.js event loop order `process.nextTick`, promises and `setTimeout`?",
    body: "Order within one turn:\n\n1. Synchronous code\n2. `process.nextTick` queue\n3. Promise microtasks\n4. Timers (`setTimeout`/`setInterval`), then I/O callbacks, then `setImmediate`\n\n```js\nsetTimeout(() => console.log('timeout'), 0)\nPromise.resolve().then(() => console.log('promise'))\nprocess.nextTick(() => console.log('tick'))\n// tick, promise, timeout\n```",
    domainSlugs: ["node"],
    sourceRef: "Event loop",
  },
  {
    kind: "note",
    question: null,
    body: "### Composite index column order\n\nPut the **equality** columns first, then the **range** column. A composite index on `(user_id, created_at)` serves:\n\n```sql\nSELECT * FROM orders\nWHERE user_id = 42 AND created_at > '2026-01-01';\n```\n\nbut it can't help a query that filters only on `created_at` (leftmost-prefix rule).",
    domainSlugs: ["mysql"],
    sourceRef: "Indexing",
  },
  {
    kind: "qa",
    question: "When would you choose a message queue over a direct synchronous call between services?",
    body: "- **Decouple** producer and consumer availability\n- **Absorb spikes** (buffering / load levelling)\n- **Retry & dead-lettering** for flaky downstreams\n- **Fan-out** to multiple consumers\n\nTrade-off: you give up immediate consistency and simple request/response semantics.",
    domainSlugs: ["hld"],
    sourceRef: "Messaging",
  },
  {
    kind: "qa",
    question: "What does the Single Responsibility Principle actually say?",
    body: "A class should have **one reason to change** — one actor/stakeholder it answers to.\n\nIt is about *cohesion of change*, not 'does only one thing'. A `Report` class that both computes figures **and** formats HTML changes for two different reasons.",
    domainSlugs: ["lld"],
    sourceRef: "SOLID",
  },
  {
    kind: "note",
    question: null,
    body: "### Retrieval-Augmented Generation in one breath\n\n**Chunk → embed → store → retrieve top-k → stuff into prompt → generate.**\n\nMost RAG failures are *retrieval* failures: bad chunking, no reranking, or the answer simply isn't in the corpus. Evaluate retrieval (recall@k) separately from generation.",
    domainSlugs: ["ai-engineering", "llm"],
    sourceRef: "RAG",
  },
  {
    kind: "qa",
    question: "Why do transformers use positional encodings?",
    body: "Self-attention is **permutation-invariant** — it treats the input as a set. Positional encodings inject order information so 'dog bites man' differs from 'man bites dog'.\n\nVariants: sinusoidal (original), learned absolute, and relative schemes like **RoPE** used in most modern LLMs.",
    domainSlugs: ["llm"],
    sourceRef: "Transformers",
  },
  {
    kind: "qa",
    question: "What is a Python generator and why is it memory-efficient?",
    body: "A function using `yield` returns a lazy iterator that produces one value at a time and keeps its local state between calls.\n\n```python\ndef read_lines(path):\n    with open(path) as f:\n        for line in f:\n            yield line.rstrip()\n\nfor line in read_lines('huge.log'):\n    ...  # never loads the whole file\n```",
    domainSlugs: ["python"],
    sourceRef: "Iterators & generators",
  },
  {
    kind: "qa",
    question: "What does InnoDB's REPEATABLE READ guarantee, and what can still go wrong?",
    body: "Within a transaction, repeated plain `SELECT`s read from the **same snapshot** (MVCC), so non-repeatable reads are prevented. InnoDB also uses next-key locks to prevent most phantoms for locking reads.\n\nStill possible: **write skew**, and surprises when mixing snapshot reads with locking reads (`SELECT … FOR UPDATE`) that see the latest committed data.",
    domainSlugs: ["mysql", "hld"],
    sourceRef: "Transactions",
  },
  {
    kind: "note",
    question: null,
    body: "### Caching: the three questions\n\n1. **What** is cacheable? (read-heavy, tolerant of staleness)\n2. **Where**? (client, CDN, app, DB)\n3. **How does it get invalidated?** TTL, write-through, or explicit purge.\n\n> There are only two hard things in computer science: cache invalidation and naming things.",
    domainSlugs: ["hld"],
    sourceRef: "Caching",
  },
  {
    kind: "qa",
    question: "Strategy vs State pattern — how do you tell them apart?",
    body: "Same structure, different intent.\n\n- **Strategy**: the *client* picks an interchangeable algorithm (e.g. sort comparator)\n- **State**: the *object itself* swaps behaviour as its internal state changes (e.g. `Order: Pending → Paid → Shipped`)",
    domainSlugs: ["lld"],
    sourceRef: "Design patterns",
  },
  {
    kind: "note",
    question: null,
    body: "### Prompt caching: keep the prefix stable\n\nCaching is a **prefix match**. Put stable content (system prompt, tools, reference docs) first and volatile content (timestamps, user question) last. A single changed byte early in the prompt invalidates everything after it.",
    domainSlugs: ["ai-engineering", "llm"],
    sourceRef: "Cost & latency",
  },
];

/** Dev-only: load a small multi-domain deck so the feed can be exercised without Claude. */
export async function seedDemoDeck(): Promise<{ resourceId: string; inserted: number }> {
  const db = await getDb();
  const hash = contentHash("demo-deck-v1");
  const [created] = await db
    .insert(schema.resources)
    .values({
      type: "text",
      title: "Demo deck",
      contentHash: hash,
      status: "ready",
      chunksTotal: 1,
      chunksDone: 1,
    })
    .onConflictDoNothing()
    .returning({ id: schema.resources.id });

  const resourceId =
    created?.id ??
    (
      await db
        .select({ id: schema.resources.id })
        .from(schema.resources)
        .where(eq(schema.resources.contentHash, hash))
    )[0].id;

  const inserted = await insertCards(resourceId, DEMO, 0);
  return { resourceId, inserted };
}
