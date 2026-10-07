export type Chunk = { text: string; sourceRef: string | null };

/** ~6K tokens of English per chunk; one Claude call each. */
export const TARGET_CHARS = 24_000;
export const MAX_CHARS = 30_000;

export const estimateTokens = (chars: number) => Math.ceil(chars / 4);

type Block = { text: string; ref: string | null };

/** Split text that is too long for one chunk at paragraph, then line, then hard boundaries. */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };
  const pieces = text.split(/\n{2,}/);
  for (const piece of pieces) {
    if (piece.length > max) {
      push();
      // A single huge paragraph (or minified blob): fall back to lines, then fixed windows.
      let buf = "";
      for (const line of piece.split("\n")) {
        if (line.length > max) {
          if (buf) parts.push(buf.trim());
          buf = "";
          for (let i = 0; i < line.length; i += max) parts.push(line.slice(i, i + max));
        } else if (buf.length + line.length + 1 > max) {
          parts.push(buf.trim());
          buf = line;
        } else {
          buf += (buf ? "\n" : "") + line;
        }
      }
      if (buf.trim()) parts.push(buf.trim());
    } else if (current.length + piece.length + 2 > max) {
      push();
      current = piece;
    } else {
      current += (current ? "\n\n" : "") + piece;
    }
  }
  push();
  return parts;
}

/** Greedily pack blocks into chunks of ~TARGET_CHARS, labelling each with its first ref. */
function pack(blocks: Block[], target: number, max: number, refFor: (b: Block[]) => string | null): Chunk[] {
  const chunks: Chunk[] = [];
  let group: Block[] = [];
  let size = 0;
  const flush = () => {
    if (!group.length) return;
    chunks.push({ text: group.map((b) => b.text).join("\n\n"), sourceRef: refFor(group) });
    group = [];
    size = 0;
  };
  for (const block of blocks) {
    for (const piece of splitLong(block.text, max)) {
      const part: Block = { text: piece, ref: block.ref };
      if (size > 0 && size + piece.length > target) flush();
      group.push(part);
      size += piece.length + 2;
    }
  }
  flush();
  return chunks;
}

/** PDF pages → chunks labelled "p. 4" / "pp. 4–9". */
export function chunkPages(
  pages: { page: number; text: string }[],
  target = TARGET_CHARS,
  max = MAX_CHARS,
): Chunk[] {
  const blocks = pages
    .map((p) => ({ text: p.text.trim(), ref: String(p.page) }))
    .filter((b) => b.text);
  return pack(blocks, target, max, (group) => {
    const nums = group.map((b) => Number(b.ref));
    const first = Math.min(...nums);
    const last = Math.max(...nums);
    return first === last ? `p. ${first}` : `pp. ${first}–${last}`;
  });
}

/**
 * Markdown-ish text (from web pages) → chunks. Splits on headings so related material stays
 * together, and labels each chunk with the first heading inside it.
 */
export function chunkMarkdown(text: string, target = TARGET_CHARS, max = MAX_CHARS): Chunk[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: Block[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  let inFence = false;

  const closeSection = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ text: body, ref: heading });
    buf = [];
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (h) {
      closeSection();
      heading = h[2];
    }
    buf.push(line);
  }
  closeSection();

  return pack(sections, target, max, (group) => group.find((b) => b.ref)?.ref ?? null);
}

/** Plain pasted text: treat as markdown (headings split it if present, else by size). */
export const chunkText = chunkMarkdown;
