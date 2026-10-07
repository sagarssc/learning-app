import { and, asc, count, desc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { insertCards } from "@/lib/card-store";
import { GenerationError, RefusalError, generateCards } from "@/lib/ai/generate-cards";
import type { Prepared } from "@/lib/ingest";
import { slugify } from "@/lib/slug";
import type { ResourceStatus } from "@/lib/types";

const { resources, resourceChunks: rc, cards, domains } = schema;

/** A chunk claimed but not finished after this long is assumed abandoned (tab closed, crash). */
const STALE_CLAIM_MS = 5 * 60 * 1000;
const CONTEXT_QUESTIONS = 60;

export async function createResource(p: Prepared): Promise<{ id: string; duplicate: boolean; chunks: number }> {
  const db = await getDb();
  const [created] = await db
    .insert(resources)
    .values({
      type: p.type,
      title: p.title,
      sourceUrl: p.sourceUrl,
      blobUrl: p.blobUrl,
      contentHash: p.hash,
      status: "queued",
      chunksTotal: p.chunks.length,
    })
    .onConflictDoNothing()
    .returning({ id: resources.id });

  if (!created) {
    const [existing] = await db
      .select({ id: resources.id, chunks: resources.chunksTotal })
      .from(resources)
      .where(eq(resources.contentHash, p.hash));
    return { id: existing.id, duplicate: true, chunks: existing.chunks };
  }

  try {
    await db.insert(rc).values(
      p.chunks.map((c, idx) => ({ resourceId: created.id, idx, text: c.text, sourceRef: c.sourceRef })),
    );
  } catch (err) {
    await db.delete(resources).where(eq(resources.id, created.id)); // don't leave a chunkless husk
    throw err;
  }
  return { id: created.id, duplicate: false, chunks: p.chunks.length };
}

export type ProcessResult = {
  status: ResourceStatus;
  chunksDone: number;
  chunksTotal: number;
  cardsAdded: number;
  /** No more work to do (ready or failed). */
  finished: boolean;
  /** Another request holds the remaining chunk(s); poll again shortly. */
  busy?: boolean;
  /** Set when this step failed; chunk stays queued so it can be retried. */
  error?: string;
};

/** A chunk is claimable if it's pending, or was claimed long ago and never finished. */
function claimable() {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  return or(eq(rc.status, "pending"), and(eq(rc.status, "processing"), lt(rc.claimedAt, staleBefore)));
}

/**
 * Process exactly one chunk of a resource: claim it, ask Claude for cards, store them.
 * Safe to call repeatedly and concurrently — claiming is a single atomic UPDATE, and card
 * inserts are idempotent. Returns null if the resource doesn't exist.
 */
export async function processNextChunk(resourceId: string): Promise<ProcessResult | null> {
  const db = await getDb();
  const [resource] = await db.select().from(resources).where(eq(resources.id, resourceId));
  if (!resource) return null;

  // A failed resource is only restarted explicitly via retryResource().
  if (resource.status === "ready" || resource.status === "failed") return progress(resource.id, 0, true);

  const [chunk] = await db
    .update(rc)
    .set({ status: "processing", claimedAt: new Date() })
    .where(
      and(
        eq(rc.resourceId, resourceId),
        claimable(),
        eq(
          rc.id,
          sql`(select ${rc.id} from ${rc} where ${rc.resourceId} = ${resourceId} and (${claimable()}) order by ${rc.idx} limit 1)`,
        ),
      ),
    )
    .returning();

  if (!chunk) {
    const [{ open }] = await db
      .select({ open: count() })
      .from(rc)
      .where(and(eq(rc.resourceId, resourceId), inArray(rc.status, ["pending", "processing"])));
    if (open > 0) return { ...(await progress(resourceId, 0, false)), busy: true };
    return finalize(resourceId, 0);
  }

  await db.update(resources).set({ status: "processing", error: null }).where(eq(resources.id, resourceId));

  const [domainRows, existing] = await Promise.all([
    db.select({ slug: domains.slug, name: domains.name, description: domains.description }).from(domains).orderBy(asc(domains.name)),
    db
      .select({ q: cards.question })
      .from(cards)
      .where(and(eq(cards.resourceId, resourceId), isNotNull(cards.question)))
      .orderBy(desc(cards.createdAt))
      .limit(CONTEXT_QUESTIONS),
  ]);

  let added = 0;
  try {
    const out = await generateCards({
      resourceTitle: resource.title,
      sourceRef: chunk.sourceRef,
      text: chunk.text,
      domains: domainRows,
      existingQuestions: existing.map((e) => e.q!).filter(Boolean),
    });

    added = await insertCards(resourceId, out.cards, chunk.idx * 1000);
    await mergeSuggestedDomains(resourceId, resource.suggestedDomains, out.suggestedDomains);
    await db.update(rc).set({ status: "done", claimedAt: null }).where(eq(rc.id, chunk.id));
  } catch (err) {
    if (err instanceof RefusalError) {
      // Declined for policy reasons: skip this section and carry on with the rest.
      await db.update(rc).set({ status: "skipped", claimedAt: null }).where(eq(rc.id, chunk.id));
    } else {
      const message = err instanceof Error ? err.message : "Unexpected error";
      await db.update(rc).set({ status: "pending", claimedAt: null }).where(eq(rc.id, chunk.id));
      const permanent = err instanceof GenerationError && !err.retryable;
      await db
        .update(resources)
        .set({ error: message, status: permanent ? "failed" : "processing" })
        .where(eq(resources.id, resourceId));
      return { ...(await progress(resourceId, 0, permanent)), error: message };
    }
  }

  const [{ open }] = await db
    .select({ open: count() })
    .from(rc)
    .where(and(eq(rc.resourceId, resourceId), inArray(rc.status, ["pending", "processing"])));
  return open === 0 ? finalize(resourceId, added) : progress(resourceId, added, false);
}

async function progress(resourceId: string, cardsAdded: number, finished: boolean): Promise<ProcessResult> {
  const db = await getDb();
  const [r] = await db.select().from(resources).where(eq(resources.id, resourceId));
  const [{ n }] = await db
    .select({ n: count() })
    .from(rc)
    .where(and(eq(rc.resourceId, resourceId), inArray(rc.status, ["done", "skipped"])));
  if (r.chunksDone !== n) await db.update(resources).set({ chunksDone: n }).where(eq(resources.id, resourceId));
  return {
    status: r.status,
    chunksDone: n,
    chunksTotal: r.chunksTotal,
    cardsAdded,
    finished,
    error: r.error ?? undefined,
  };
}

async function finalize(resourceId: string, cardsAdded: number): Promise<ProcessResult> {
  const db = await getDb();
  const [{ total }] = await db.select({ total: count() }).from(cards).where(eq(cards.resourceId, resourceId));
  const ok = total > 0;
  await db
    .update(resources)
    .set({
      status: ok ? "ready" : "failed",
      error: ok ? null : "No cards could be made from this source (nothing worth learning was found, or it was declined).",
    })
    .where(eq(resources.id, resourceId));
  return progress(resourceId, cardsAdded, true);
}

async function mergeSuggestedDomains(resourceId: string, current: string[], incoming: string[]) {
  if (!incoming.length) return;
  const db = await getDb();
  const have = new Set(current.map((s) => slugify(s)));
  const merged = [...current];
  for (const name of incoming) {
    if (!have.has(slugify(name))) {
      have.add(slugify(name));
      merged.push(name);
    }
  }
  if (merged.length !== current.length) {
    await db.update(resources).set({ suggestedDomains: merged }).where(eq(resources.id, resourceId));
  }
}

/** Put a failed/stuck resource back in the queue (keeps cards already made). */
export async function retryResource(resourceId: string): Promise<boolean> {
  const db = await getDb();
  const [r] = await db.select({ id: resources.id }).from(resources).where(eq(resources.id, resourceId));
  if (!r) return false;
  await db
    .update(rc)
    .set({ status: "pending", claimedAt: null })
    .where(and(eq(rc.resourceId, resourceId), inArray(rc.status, ["processing", "skipped"])));
  await db.update(resources).set({ status: "queued", error: null }).where(eq(resources.id, resourceId));
  return true;
}
