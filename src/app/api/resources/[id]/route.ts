import { z } from "zod";
import { notFound, parseBody, requireAuth } from "@/lib/api";
import { deleteResource, dismissSuggestedDomain, getResource } from "@/lib/resources";

const Patch = z.object({ dismissSuggestion: z.string().min(1).max(60) });

export async function GET(_req: Request, ctx: RouteContext<"/api/resources/[id]">) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  const resource = await getResource(id);
  return resource ? Response.json({ resource }, { headers: { "cache-control": "no-store" } }) : notFound();
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/resources/[id]">) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  const parsed = await parseBody(request, Patch);
  if ("error" in parsed) return parsed.error;
  return (await dismissSuggestedDomain(id, parsed.data.dismissSuggestion))
    ? Response.json({ ok: true })
    : notFound();
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/resources/[id]">) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  return (await deleteResource(id)) ? Response.json({ ok: true }) : notFound();
}
