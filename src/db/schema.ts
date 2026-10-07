import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const RESOURCE_TYPES = ["pdf", "url", "text"] as const;
export const RESOURCE_STATUSES = ["queued", "processing", "ready", "failed"] as const;
export const CHUNK_STATUSES = ["pending", "processing", "done", "skipped"] as const;
export const CARD_KINDS = ["qa", "note"] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];
export type ChunkStatus = (typeof CHUNK_STATUSES)[number];
export type CardKind = (typeof CARD_KINDS)[number];

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const domains = pgTable("domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  // Shown to the LLM so it can tell "node" from "llm" on ambiguous content.
  description: text("description").notNull().default(""),
  createdAt: createdAt(),
});

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").$type<ResourceType>().notNull(),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    blobUrl: text("blob_url"),
    contentHash: text("content_hash").notNull(),
    status: text("status").$type<ResourceStatus>().notNull().default("queued"),
    chunksTotal: integer("chunks_total").notNull().default(0),
    chunksDone: integer("chunks_done").notNull().default(0),
    error: text("error"),
    // Domain names the LLM wanted but that aren't in `domains` yet.
    suggestedDomains: jsonb("suggested_domains").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("resources_content_hash_idx").on(t.contentHash)],
);

export const resourceChunks = pgTable(
  "resource_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    text: text("text").notNull(),
    // Human-readable location, e.g. "pp. 3-7" or "Section: Indexing".
    sourceRef: text("source_ref"),
    status: text("status").$type<ChunkStatus>().notNull().default("pending"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("resource_chunks_resource_idx").on(t.resourceId, t.idx),
    index("resource_chunks_status_idx").on(t.resourceId, t.status),
  ],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    kind: text("kind").$type<CardKind>().notNull(),
    question: text("question"),
    body: text("body").notNull(),
    sourceRef: text("source_ref"),
    // Document order within a resource.
    position: integer("position").notNull().default(0),
    // Makes chunk processing idempotent if a request is retried.
    dedupeKey: text("dedupe_key").notNull(),
    starred: boolean("starred").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("cards_resource_dedupe_idx").on(t.resourceId, t.dedupeKey),
    index("cards_resource_position_idx").on(t.resourceId, t.position),
  ],
);

export const cardDomains = pgTable(
  "card_domains",
  {
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.domainId] }),
    index("card_domains_domain_idx").on(t.domainId),
  ],
);

export const resourceDomains = pgTable(
  "resource_domains",
  {
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.domainId] }),
    index("resource_domains_domain_idx").on(t.domainId),
  ],
);
