import { z } from "zod";
import { notFound, parseBody, requireAuth } from "@/lib/api";
import { deleteDomain, updateDomain } from "@/lib/domains";

const Patch = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  description: z.string().max(300).optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/domains/[id]">) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  const parsed = await parseBody(request, Patch);
  if ("error" in parsed) return parsed.error;
  return (await updateDomain(id, parsed.data)) ? Response.json({ ok: true }) : notFound();
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/domains/[id]">) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  return (await deleteDomain(id)) ? Response.json({ ok: true }) : notFound();
}
