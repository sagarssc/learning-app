import { z } from "zod";
import { badRequest, parseBody, requireAuth } from "@/lib/api";
import { IngestError } from "@/lib/ingest/errors";
import { prepareText, preparePdf, prepareUrl, type Prepared } from "@/lib/ingest";
import { estimateTokens } from "@/lib/ingest/chunk";
import { fetchPublic } from "@/lib/ingest/fetch-page";
import { createResource } from "@/lib/pipeline";
import { listResources } from "@/lib/resources";

// Importing a big page/PDF can take a while (fetch + parse + chunk).
export const maxDuration = 60;

/** Multipart uploads go through the serverless function body, which Vercel caps near 4.5 MB. */
const MAX_DIRECT_PDF_BYTES = 4 * 1024 * 1024;

const Json = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), url: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("text"), title: z.string().max(200).optional(), text: z.string().min(1).max(2_000_000) }),
  z.object({ type: z.literal("pdf"), blobUrl: z.url().max(2000), filename: z.string().max(300).default("document.pdf") }),
]);

/** PDFs uploaded via Vercel Blob live on this host; refuse anything else (SSRF guard). */
function isBlobUrl(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return Response.json({ resources: await listResources() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const prepared = await prepareFromRequest(request);
    if (prepared instanceof Response) return prepared;

    const created = await createResource(prepared);
    return Response.json(
      {
        id: created.id,
        duplicate: created.duplicate,
        title: prepared.title,
        chunks: created.chunks,
        estimatedInputTokens: prepared.chunks.reduce((n, c) => n + estimateTokens(c.text.length), 0),
      },
      { status: created.duplicate ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof IngestError) return badRequest(err.message);
    console.error("create resource failed", err);
    return Response.json({ error: "Something went wrong importing that source" }, { status: 500 });
  }
}

async function prepareFromRequest(request: Request): Promise<Prepared | Response> {
  if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return badRequest("No file was uploaded");
    if (file.size > MAX_DIRECT_PDF_BYTES) {
      return badRequest("That PDF is over 4 MB. Configure Vercel Blob (BLOB_READ_WRITE_TOKEN) to upload larger files.");
    }
    return preparePdf(new Uint8Array(await file.arrayBuffer()), file.name);
  }

  const parsed = await parseBody(request, Json);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;

  if (body.type === "url") return prepareUrl(body.url);
  if (body.type === "text") return prepareText(body.title, body.text);

  if (!isBlobUrl(body.blobUrl)) return badRequest("Unsupported upload location");
  const fetched = await fetchPublic(body.blobUrl);
  return preparePdf(fetched.body, body.filename, { blobUrl: body.blobUrl });
}
