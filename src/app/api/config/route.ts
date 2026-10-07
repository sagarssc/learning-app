/** Non-secret capability flags the UI needs (e.g. which PDF upload path to use). */
export async function GET() {
  return Response.json(
    { blobEnabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN), mockLlm: process.env.MOCK_LLM === "1" },
    { headers: { "cache-control": "no-store" } },
  );
}
