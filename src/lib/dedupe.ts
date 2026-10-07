import { createHash } from "node:crypto";

/** Lowercase, strip punctuation/whitespace noise so near-identical cards collide. */
export function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_#>~-]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable key for a card: questions dedupe on the question, notes on the body. */
export function dedupeKey(card: { question: string | null; body: string }): string {
  const basis = normalizeForDedupe(card.question?.trim() ? card.question : card.body);
  return createHash("sha1").update(basis).digest("hex").slice(0, 24);
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
