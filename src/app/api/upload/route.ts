import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAuth } from "@/lib/api";

/**
 * Issues short-lived client-upload tokens so the browser can send PDFs straight to Vercel
 * Blob, bypassing the ~4.5 MB serverless request-body limit.
 */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ error: "Vercel Blob isn't configured (BLOB_READ_WRITE_TOKEN)" }, { status: 501 });
  }

  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: 60 * 1024 * 1024,
        addRandomSuffix: true,
      }),
    });
    return Response.json(json);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 400 });
  }
}
