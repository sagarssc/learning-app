import { contentHash } from "@/lib/dedupe";
import type { ResourceType } from "@/lib/types";
import { chunkMarkdown, chunkPages, type Chunk } from "./chunk";
import { IngestError } from "./errors";
import { extractPdf } from "./extract-pdf";
import { extractWebPage } from "./extract-url";
import { fetchPublic } from "./fetch-page";

/** Hard ceiling so one import can't run up an unbounded Claude bill (~1.4M characters). */
export const MAX_CHUNKS = 60;

export type Prepared = {
  type: ResourceType;
  title: string;
  sourceUrl: string | null;
  blobUrl: string | null;
  hash: string;
  chunks: Chunk[];
};

function checked(chunks: Chunk[]): Chunk[] {
  if (!chunks.length) throw new IngestError("There's no text to learn from in that source");
  if (chunks.length > MAX_CHUNKS) {
    throw new IngestError(
      `That's too large to import in one go (${chunks.length} sections; the limit is ${MAX_CHUNKS}). Try splitting it into parts.`,
    );
  }
  return chunks;
}

function decode(body: Uint8Array, contentType: string): string {
  const charset = contentType.match(/charset=([\w-]+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

const looksLikePdf = (b: Uint8Array) => b.length > 4 && String.fromCharCode(...b.subarray(0, 5)) === "%PDF-";

export async function preparePdf(
  bytes: Uint8Array,
  filename: string,
  origin: { sourceUrl?: string | null; blobUrl?: string | null } = {},
): Promise<Prepared> {
  if (!looksLikePdf(bytes)) throw new IngestError("That file doesn't look like a PDF");
  const fallbackTitle = filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled PDF";
  const { title, pages } = await extractPdf(bytes, fallbackTitle);
  return {
    type: "pdf",
    title,
    sourceUrl: origin.sourceUrl ?? null,
    blobUrl: origin.blobUrl ?? null,
    hash: contentHash(pages.map((p) => p.text).join("\n")),
    chunks: checked(chunkPages(pages)),
  };
}

export async function prepareUrl(rawUrl: string): Promise<Prepared> {
  const fetched = await fetchPublic(rawUrl.trim());
  const href = fetched.url.toString();

  if (fetched.contentType === "application/pdf" || looksLikePdf(fetched.body)) {
    const name = decodeURIComponent(fetched.url.pathname.split("/").pop() || "document.pdf");
    return preparePdf(fetched.body, name, { sourceUrl: href });
  }

  const isHtml = /html|xml/.test(fetched.contentType);
  if (!isHtml && !fetched.contentType.startsWith("text/")) {
    throw new IngestError(`Unsupported content type: ${fetched.contentType || "unknown"}. Try an article, docs page, or PDF link.`);
  }

  const text = decode(fetched.body, fetched.contentType);
  const { title, markdown } = isHtml
    ? extractWebPage(text, fetched.url)
    : { title: fetched.url.hostname + fetched.url.pathname, markdown: text };

  return {
    type: "url",
    title,
    sourceUrl: href,
    blobUrl: null,
    hash: contentHash(markdown),
    chunks: checked(chunkMarkdown(markdown)),
  };
}

export function prepareText(title: string | undefined, text: string): Prepared {
  const trimmed = text.trim();
  if (trimmed.length < 80) throw new IngestError("Paste a bit more text — that's too short to make cards from");
  const firstLine = trimmed.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").trim() ?? "Pasted text";
  return {
    type: "text",
    title: (title?.trim() || firstLine).slice(0, 120),
    sourceUrl: null,
    blobUrl: null,
    hash: contentHash(trimmed),
    chunks: checked(chunkMarkdown(trimmed)),
  };
}
