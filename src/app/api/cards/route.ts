import { z } from "zod";
import { badRequest } from "@/lib/api";
import { listCards } from "@/lib/cards";

const Query = z.object({
  domain: z.string().optional(), // comma-separated slugs
  mode: z.enum(["seq", "shuffle"]).default("seq"),
  seed: z.string().max(64).optional(),
  starred: z.enum(["1", "0"]).optional(),
  resource: z.uuid().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export async function GET(request: Request) {
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return badRequest("invalid query", z.treeifyError(parsed.error));
  const q = parsed.data;

  const page = await listCards({
    domainSlugs: q.domain?.split(",").map((s) => s.trim()).filter(Boolean),
    mode: q.mode,
    seed: q.seed,
    starred: q.starred === "1",
    resourceId: q.resource,
    offset: q.offset,
    limit: q.limit,
  });
  return Response.json(page, { headers: { "cache-control": "no-store" } });
}
