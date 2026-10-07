import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { badRequest, parseBody, requireAuth } from "@/lib/api";
import { slugify } from "@/lib/slug";
import type { DomainDTO } from "@/lib/types";

const { domains, cardDomains } = schema;

export async function GET() {
  const db = await getDb();
  const rows = await db
    .select({
      id: domains.id,
      slug: domains.slug,
      name: domains.name,
      color: domains.color,
      description: domains.description,
      cardCount: sql<number>`count(${cardDomains.cardId})::int`,
    })
    .from(domains)
    .leftJoin(cardDomains, eq(cardDomains.domainId, domains.id))
    .groupBy(domains.id)
    .orderBy(asc(domains.name));
  return Response.json({ domains: rows satisfies DomainDTO[] }, { headers: { "cache-control": "no-store" } });
}

const Create = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
  description: z.string().max(300).default(""),
});

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const parsed = await parseBody(request, Create);
  if ("error" in parsed) return parsed.error;

  const slug = slugify(parsed.data.name);
  if (!slug) return badRequest("name must contain letters or numbers");

  const db = await getDb();
  const [created] = await db
    .insert(domains)
    .values({ slug, ...parsed.data })
    .onConflictDoNothing({ target: domains.slug })
    .returning();
  if (!created) return Response.json({ error: "A domain with that name already exists" }, { status: 409 });
  return Response.json({ domain: created }, { status: 201 });
}
