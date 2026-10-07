import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { IngestError } from "./errors";

const MIN_CHARS = 200;

/** Re-join words hyphenated across line breaks and collapse layout whitespace. */
export function normalizePdfText(text: string): string {
  return text
    .replace(/(\p{L})-\n(\p{L})/gu, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdf(
  bytes: Uint8Array,
  fallbackTitle: string,
): Promise<{ title: string; pages: { page: number; text: string }[] }> {
  let pdf;
  try {
    // unpdf/pdf.js may transfer the buffer, so give it its own copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new IngestError("That file doesn't look like a readable PDF");
  }

  const { text } = await extractText(pdf, { mergePages: false });
  const pages = text.map((t, i) => ({ page: i + 1, text: normalizePdfText(t) }));
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  if (chars < MIN_CHARS) {
    throw new IngestError(
      "No text found in that PDF. It looks like a scan (images only), which isn't supported yet.",
    );
  }

  const meta = await getMeta(pdf).catch(() => null);
  const metaTitle = typeof meta?.info?.Title === "string" ? meta.info.Title.trim() : "";
  return { title: (metaTitle || fallbackTitle).slice(0, 200), pages };
}
