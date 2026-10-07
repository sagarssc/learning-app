import { z } from "zod";
import { parseBody } from "@/lib/api";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  checkPassword,
  createSessionToken,
} from "@/lib/auth";

const Body = z.object({ password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const parsed = await parseBody(request, Body);
  if ("error" in parsed) return parsed.error;

  if (!checkPassword(parsed.data.password)) {
    // Slow down guessing against a single shared passphrase.
    await new Promise((r) => setTimeout(r, 800));
    return Response.json({ error: "Wrong passphrase" }, { status: 401 });
  }

  const token = await createSessionToken();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`,
    },
  });
}
