import { z } from "zod";
import { badRequest, notFound, parseBody, requireAuth } from "@/lib/api";
import { mergeDomains } from "@/lib/domains";

const Body = z.object({ intoId: z.uuid() });

/** Merge this domain into another: its cards/resources take the target tag, then it's removed. */
export async function POST(request: Request, ctx: RouteContext<"/api/domains/[id]/merge">) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  const parsed = await parseBody(request, Body);
  if ("error" in parsed) return parsed.error;
  if (parsed.data.intoId === id) return badRequest("Pick a different domain to merge into");
  return (await mergeDomains(id, parsed.data.intoId)) ? Response.json({ ok: true }) : notFound();
}
