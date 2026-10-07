import type { Db } from "./index";
import { domains } from "./schema";

export const DEFAULT_DOMAINS = [
  {
    slug: "python",
    name: "Python",
    color: "#3b82f6",
    description:
      "The Python language and ecosystem: syntax, stdlib, typing, async, packaging, FastAPI/Django/Flask, data libraries.",
  },
  {
    slug: "node",
    name: "Node.js",
    color: "#22c55e",
    description:
      "Node.js runtime and JS/TS backend work: event loop, streams, npm, Express/Nest, async patterns.",
  },
  {
    slug: "mysql",
    name: "MySQL",
    color: "#f59e0b",
    description:
      "Relational databases and SQL: indexing, query tuning, transactions/isolation, schema design, replication.",
  },
  {
    slug: "hld",
    name: "HLD",
    color: "#ec4899",
    description:
      "High-level system design: scalability, load balancing, caching, queues, sharding, CAP, architecture trade-offs.",
  },
  {
    slug: "lld",
    name: "LLD",
    color: "#a855f7",
    description:
      "Low-level design: OOP, SOLID, design patterns, class and API design, concurrency primitives.",
  },
  {
    slug: "ai-engineering",
    name: "AI Engineering",
    color: "#14b8a6",
    description:
      "Building AI products: RAG, evals, agents, tool use, prompt engineering, LLMOps, deployment and cost.",
  },
  {
    slug: "llm",
    name: "LLM",
    color: "#ef4444",
    description:
      "How large language models work: transformers, tokenization, training/fine-tuning, inference, scaling.",
  },
];

/** Idempotent: inserts the default domains that don't exist yet. */
export async function seedDomains(db: Db) {
  await db.insert(domains).values(DEFAULT_DOMAINS).onConflictDoNothing({ target: domains.slug });
}
