import { z } from "zod";
import { notFound, requireAuth } from "@/lib/api";
import { retryResource } from "@/lib/pipeline";

/** Re-queue a failed resource (and any sections that were skipped) so processing can resume. */
export async function POST(_req: Request, ctx: RouteContext<"/api/resources/[id]/retry">) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  return (await retryResource(id)) ? Response.json({ ok: true }) : notFound();
}
