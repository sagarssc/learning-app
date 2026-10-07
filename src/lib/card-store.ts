import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { dedupeKey } from "@/lib/dedupe";
import type { CardKind } from "@/lib/types";

const { cards, cardDomains, domains, resourceDomains } = schema;

export type NewCard = {
  kind: CardKind;
  question: string | null;
  body: string;
  /** Domain slugs. Slugs that don't exist in `domains` are skipped. */
  domainSlugs: string[];
  sourceRef: string | null;
};

/**
 * Insert cards for a resource and tag them. Idempotent: a card whose dedupe key
 * already exists for this resource is skipped, so retrying a chunk can't create
 * duplicates. Also records the union of tags on the resource. Returns the number
 * of cards actually inserted.
 */
export async function insertCards(
  resourceId: string,
  items: NewCard[],
  positionBase: number,
): Promise<number> {
  if (!items.length) return 0;
  const db = await getDb();

  const allDomains = await db.select({ id: domains.id, slug: domains.slug }).from(domains);
  const idBySlug = new Map(allDomains.map((d) => [d.slug, d.id]));

  const rows = items.map((item, i) => ({
    resourceId,
    kind: item.kind,
    question: item.kind === "qa" ? item.question : null,
    body: item.body,
    sourceRef: item.sourceRef,
    position: positionBase + i,
    dedupeKey: dedupeKey(item),
  }));
  // Within one batch, keep the first of any duplicate keys.
  const unique = [...new Map(rows.map((r) => [r.dedupeKey, r])).values()];

  const inserted = await db
    .insert(cards)
    .values(unique)
    .onConflictDoNothing()
    .returning({ id: cards.id, dedupeKey: cards.dedupeKey });

  const keyToSlugs = new Map(items.map((item) => [dedupeKey(item), item.domainSlugs]));
  const tagRows: { cardId: string; domainId: string }[] = [];
  const resourceTagIds = new Set<string>();
  for (const { id, dedupeKey: key } of inserted) {
    for (const slug of new Set(keyToSlugs.get(key) ?? [])) {
      const domainId = idBySlug.get(slug);
      if (!domainId) continue;
      tagRows.push({ cardId: id, domainId });
      resourceTagIds.add(domainId);
    }
  }

  if (tagRows.length) await db.insert(cardDomains).values(tagRows).onConflictDoNothing();
  if (resourceTagIds.size) {
    await db
      .insert(resourceDomains)
      .values([...resourceTagIds].map((domainId) => ({ resourceId, domainId })))
      .onConflictDoNothing();
  }
  return inserted.length;
}

export async function deleteCard(cardId: string) {
  const db = await getDb();
  await db.delete(cards).where(eq(cards.id, cardId));
}
