import { eq } from "drizzle-orm";
import { z } from "zod";
import { notFound, parseBody, requireAuth } from "@/lib/api";
import { deleteCard } from "@/lib/card-store";
import { setCardDomains } from "@/lib/cards";
import { getDb, schema } from "@/db";

const Patch = z.object({
  starred: z.boolean().optional(),
  seen: z.literal(true).optional(),
  domainIds: z.array(z.uuid()).max(50).optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/cards/[id]">) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  const parsed = await parseBody(request, Patch);
  if ("error" in parsed) return parsed.error;
  const { starred, seen, domainIds } = parsed.data;

  const db = await getDb();
  const [existing] = await db.select({ id: schema.cards.id }).from(schema.cards).where(eq(schema.cards.id, id));
  if (!existing) return notFound();

  const set: Partial<typeof schema.cards.$inferInsert> = {};
  if (starred !== undefined) set.starred = starred;
  if (seen) set.lastSeenAt = new Date();
  if (Object.keys(set).length) await db.update(schema.cards).set(set).where(eq(schema.cards.id, id));
  if (domainIds) await setCardDomains(id, domainIds);

  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/cards/[id]">) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  await deleteCard(id);
  return Response.json({ ok: true });
}
