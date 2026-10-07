import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

const { domains } = schema;

export type DomainPatch = { name?: string; color?: string; description?: string };

/** Rename/recolor/describe a domain. The slug is intentionally stable so saved URLs keep working. */
export async function updateDomain(id: string, patch: DomainPatch): Promise<boolean> {
  const db = await getDb();
  const set: DomainPatch = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.description !== undefined) set.description = patch.description;
  if (!Object.keys(set).length) {
    const [exists] = await db.select({ id: domains.id }).from(domains).where(eq(domains.id, id));
    return Boolean(exists);
  }
  const updated = await db.update(domains).set(set).where(eq(domains.id, id)).returning({ id: domains.id });
  return updated.length > 0;
}

/** Delete a domain. Cards keep existing; they just lose this tag (join rows cascade). */
export async function deleteDomain(id: string): Promise<boolean> {
  const db = await getDb();
  const deleted = await db.delete(domains).where(eq(domains.id, id)).returning({ id: domains.id });
  return deleted.length > 0;
}

/**
 * Fold one domain into another: everything tagged `fromId` becomes tagged `intoId` (without
 * duplicating tags on cards that had both), then `fromId` is deleted.
 */
export async function mergeDomains(fromId: string, intoId: string): Promise<boolean> {
  if (fromId === intoId) return false;
  const db = await getDb();
  const found = await db.select({ id: domains.id }).from(domains).where(sql`${domains.id} in (${fromId}, ${intoId})`);
  if (found.length !== 2) return false;

  await db.execute(sql`
    insert into card_domains (card_id, domain_id)
    select card_id, ${intoId}::uuid from card_domains where domain_id = ${fromId}::uuid
    on conflict do nothing`);
  await db.execute(sql`
    insert into resource_domains (resource_id, domain_id)
    select resource_id, ${intoId}::uuid from resource_domains where domain_id = ${fromId}::uuid
    on conflict do nothing`);
  await db.delete(domains).where(eq(domains.id, fromId)); // cascades the old join rows
  return true;
}
