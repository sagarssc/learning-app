import { z } from "zod";
import { notFound, requireAuth } from "@/lib/api";
import { processNextChunk } from "@/lib/pipeline";

// One chunk = one Claude call; allow generous time on Vercel (verify against your plan's limit).
export const maxDuration = 300;

/** Process the next pending section of a resource. The client calls this in a loop. */
export async function POST(_req: Request, ctx: RouteContext<"/api/resources/[id]/process">) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  const result = await processNextChunk(id);
  return result ? Response.json(result, { headers: { "cache-control": "no-store" } }) : notFound();
}
