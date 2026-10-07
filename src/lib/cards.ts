import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CardsPage, DomainTag, FeedCard } from "@/lib/types";

const { cards, cardDomains, domains, resources } = schema;

export type ListCardsOptions = {
  /** Domain slugs; a card matches if it has ANY of them. Empty = all cards. */
  domainSlugs?: string[];
  mode?: "seq" | "shuffle";
  /** Shuffle seed — same seed gives the same order, so paging and "previous" are stable. */
  seed?: string;
  starred?: boolean;
  resourceId?: string;
  offset?: number;
  limit?: number;
};

export async function listCards(opts: ListCardsOptions = {}): Promise<CardsPage> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const where: SQL[] = [];
  if (opts.domainSlugs?.length) {
    where.push(
      sql`exists (
        select 1 from ${cardDomains}
        join ${domains} on ${domains.id} = ${cardDomains.domainId}
        where ${cardDomains.cardId} = ${cards.id}
          and ${inArray(domains.slug, opts.domainSlugs)}
      )`,
    );
  }
  if (opts.starred) where.push(eq(cards.starred, true));
  if (opts.resourceId) where.push(eq(cards.resourceId, opts.resourceId));

  const order =
    opts.mode === "shuffle"
      ? [sql`md5(${cards.id}::text || ${opts.seed ?? ""})`, asc(cards.id)]
      : // Newest resource first, document order within a resource.
        [desc(resources.createdAt), desc(resources.id), asc(cards.position), asc(cards.id)];

  // Fetch one extra row to learn whether another page exists.
  const rows = await db
    .select({
      card: cards,
      resourceId: resources.id,
      resourceTitle: resources.title,
      resourceType: resources.type,
      sourceUrl: resources.sourceUrl,
      blobUrl: resources.blobUrl,
    })
    .from(cards)
    .innerJoin(resources, eq(resources.id, cards.resourceId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(...order)
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const tagsByCard = await loadCardTags(page.map((r) => r.card.id));

  return {
    hasMore,
    cards: page.map(
      (r): FeedCard => ({
        id: r.card.id,
        kind: r.card.kind,
        question: r.card.question,
        body: r.card.body,
        sourceRef: r.card.sourceRef,
        starred: r.card.starred,
        resource: {
          id: r.resourceId,
          title: r.resourceTitle,
          type: r.resourceType,
          sourceUrl: r.sourceUrl,
          blobUrl: r.blobUrl,
        },
        domains: tagsByCard.get(r.card.id) ?? [],
      }),
    ),
  };
}

export async function loadCardTags(cardIds: string[]): Promise<Map<string, DomainTag[]>> {
  const map = new Map<string, DomainTag[]>();
  if (!cardIds.length) return map;
  const db = await getDb();
  const rows = await db
    .select({
      cardId: cardDomains.cardId,
      id: domains.id,
      slug: domains.slug,
      name: domains.name,
      color: domains.color,
    })
    .from(cardDomains)
    .innerJoin(domains, eq(domains.id, cardDomains.domainId))
    .where(inArray(cardDomains.cardId, cardIds))
    .orderBy(asc(domains.name));
  for (const { cardId, ...tag } of rows) {
    const list = map.get(cardId) ?? [];
    list.push(tag);
    map.set(cardId, list);
  }
  return map;
}

/** Replace a card's domain tags. Unknown domain ids are ignored. */
export async function setCardDomains(cardId: string, domainIds: string[]) {
  const db = await getDb();
  const valid = domainIds.length
    ? await db.select({ id: domains.id }).from(domains).where(inArray(domains.id, domainIds))
    : [];
  await db.delete(cardDomains).where(eq(cardDomains.cardId, cardId));
  if (valid.length) {
    await db
      .insert(cardDomains)
      .values(valid.map((d) => ({ cardId, domainId: d.id })))
      .onConflictDoNothing();
  }
}
