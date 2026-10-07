import { del } from "@vercel/blob";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DomainTag, ResourceDTO } from "@/lib/types";

const { resources, domains, resourceDomains } = schema;

const toDTO = (
  r: typeof resources.$inferSelect,
  cardCount: number,
  tags: DomainTag[],
): ResourceDTO => ({
  id: r.id,
  type: r.type,
  title: r.title,
  sourceUrl: r.sourceUrl,
  blobUrl: r.blobUrl,
  status: r.status,
  chunksTotal: r.chunksTotal,
  chunksDone: r.chunksDone,
  error: r.error,
  suggestedDomains: r.suggestedDomains,
  cardCount,
  domains: tags,
  createdAt: r.createdAt.toISOString(),
});

export async function listResources(onlyId?: string): Promise<ResourceDTO[]> {
  const db = await getDb();
  const rows = await db
    .select({
      resource: resources,
      // Written out by hand: in a single-table select Drizzle emits unqualified column names, so
      // `${resources.id}` would resolve to cards.id inside the subquery and never match.
      cardCount: sql<number>`(select count(*)::int from "cards" where "cards"."resource_id" = "resources"."id")`,
    })
    .from(resources)
    .where(onlyId ? eq(resources.id, onlyId) : undefined)
    .orderBy(desc(resources.createdAt));

  const ids = rows.map((r) => r.resource.id);
  const tagRows = ids.length
    ? await db
        .select({
          resourceId: resourceDomains.resourceId,
          id: domains.id,
          slug: domains.slug,
          name: domains.name,
          color: domains.color,
        })
        .from(resourceDomains)
        .innerJoin(domains, eq(domains.id, resourceDomains.domainId))
        .where(inArray(resourceDomains.resourceId, ids))
        .orderBy(asc(domains.name))
    : [];

  const byResource = new Map<string, DomainTag[]>();
  for (const { resourceId, ...tag } of tagRows) {
    byResource.set(resourceId, [...(byResource.get(resourceId) ?? []), tag]);
  }
  return rows.map((r) => toDTO(r.resource, r.cardCount, byResource.get(r.resource.id) ?? []));
}

export async function getResource(id: string): Promise<ResourceDTO | null> {
  return (await listResources(id))[0] ?? null;
}

/** Deletes the resource (cards, chunks and tags cascade) and its stored PDF, if any. */
export async function deleteResource(id: string): Promise<boolean> {
  const db = await getDb();
  const [r] = await db.select({ blobUrl: resources.blobUrl }).from(resources).where(eq(resources.id, id));
  if (!r) return false;
  await db.delete(resources).where(eq(resources.id, id));
  if (r.blobUrl && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(r.blobUrl).catch(() => {}); // an orphaned blob is harmless; don't fail the delete
  }
  return true;
}

/** Remove one LLM-suggested domain name from a resource (after accepting or dismissing it). */
export async function dismissSuggestedDomain(id: string, name: string): Promise<boolean> {
  const db = await getDb();
  const [r] = await db.select({ s: resources.suggestedDomains }).from(resources).where(eq(resources.id, id));
  if (!r) return false;
  await db
    .update(resources)
    .set({ suggestedDomains: r.s.filter((s) => s.toLowerCase() !== name.toLowerCase()) })
    .where(eq(resources.id, id));
  return true;
}
