import { cookies } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE, authDisabled, verifySessionToken } from "@/lib/auth";

/**
 * Defense in depth: proxy.ts already guards /api/*, but routes that write data or
 * spend Claude credits re-check the session themselves. Returns a Response to
 * short-circuit with, or null when the caller is allowed.
 */
export async function requireAuth(): Promise<Response | null> {
  if (authDisabled()) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return null;
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export function badRequest(message: string, details?: unknown) {
  return Response.json({ error: message, details }, { status: 400 });
}

export function notFound(message = "not found") {
  return Response.json({ error: message }, { status: 404 });
}

/** Parse a JSON body with a zod schema; returns the data or a ready-made 400 Response. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { error: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: badRequest("invalid JSON body") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: badRequest("invalid request", z.treeifyError(parsed.error)) };
  return { data: parsed.data };
}

export const uuid = z.uuid();
