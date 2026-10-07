import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { NewCard } from "@/lib/card-store";
import { normalizeForDedupe } from "@/lib/dedupe";
import { SYSTEM_PROMPT, buildUserPrompt, type DomainInfo } from "./prompts";

export type { DomainInfo };

export type GenerateInput = {
  resourceTitle: string;
  sourceRef: string | null;
  text: string;
  domains: DomainInfo[];
  existingQuestions: string[];
};

export type GenerateOutput = { cards: NewCard[]; suggestedDomains: string[] };

/** The model declined to process this content (safety classifier). Skip it, don't retry. */
export class RefusalError extends Error {}
/** Anything else that stopped us getting usable cards. `retryable` = worth trying again later. */
export class GenerationError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
  }
}

const MAX_CARDS_PER_CHUNK = 20;
const MAX_QUESTION_CHARS = 300;
const MAX_BODY_CHARS = 2000;

export const defaultModel = () => process.env.CLAUDE_MODEL?.trim() || "claude-opus-5-5";

/** Models that support the server-side refusal fallback beta. */
const supportsFallbacks = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

/**
 * Output schema sent to Claude. Deliberately lenient: the SDK only forwards a small subset of
 * JSON Schema (it folds `enum` into the description as a hint) and then rejects the whole
 * response if any value violates the Zod schema. So one slightly-off slug would waste an entire
 * section. Instead we describe the allowed values here and enforce them in sanitize().
 */
export function outputSchema(slugs: string[]) {
  return z.object({
    cards: z.array(
      z.object({
        kind: z.string().describe('Either "qa" or "note"'),
        question: z.string().nullable().describe("The question for a qa card; null for a note"),
        body: z.string().describe("The answer (qa) or the note text, as short markdown"),
        domains: z
          .array(z.string())
          .describe(`1-3 domain slugs, each exactly one of: ${slugs.join(", ") || "(none defined)"}`),
        source_ref: z.string().nullable().describe("Section heading or page range, if known"),
      }),
    ),
    suggested_new_domains: z.array(z.string()).describe("Title Case names of topics with no matching domain"),
  });
}

type RawOutput = z.infer<ReturnType<typeof outputSchema>>;

function normalizeKind(raw: string): "qa" | "note" | null {
  const k = raw.trim().toLowerCase();
  if (k === "qa" || k === "q&a" || k === "question") return "qa";
  if (k === "note") return "note";
  return null;
}

/**
 * Turn raw model output into storable cards: drop malformed or empty ones, map domain
 * labels to known slugs (accepting "Node.js" for `node`), cap lengths, and dedupe within the
 * batch (against each other and the questions we already have for this resource).
 */
export function sanitize(raw: RawOutput, domains: DomainInfo[], existingQuestions: string[], fallbackRef: string | null): GenerateOutput {
  const slugFor = new Map(domains.flatMap((d) => [[d.slug, d.slug] as const, [d.name.toLowerCase(), d.slug] as const]));
  const seen = new Set(existingQuestions.map(normalizeForDedupe));
  const cards: NewCard[] = [];

  for (const c of raw.cards) {
    const kind = normalizeKind(c.kind);
    if (!kind) continue;
    const body = c.body.trim().slice(0, MAX_BODY_CHARS);
    const question = kind === "qa" ? (c.question ?? "").trim().slice(0, MAX_QUESTION_CHARS) : null;
    if (!body) continue;
    if (kind === "qa" && !question) continue;

    const key = normalizeForDedupe(question ?? body);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const domainSlugs = c.domains.map((s) => slugFor.get(s.trim().toLowerCase())).filter((s): s is string => Boolean(s));
    cards.push({
      kind,
      question,
      body,
      domainSlugs: [...new Set(domainSlugs)].slice(0, 3),
      sourceRef: c.source_ref?.trim().slice(0, 120) || fallbackRef,
    });
    if (cards.length >= MAX_CARDS_PER_CHUNK) break;
  }

  const knownNames = new Set(domains.flatMap((d) => [d.slug, d.name.toLowerCase()]));
  const suggestedDomains = [
    ...new Set(
      raw.suggested_new_domains
        .map((s) => s.trim().slice(0, 40))
        .filter((s) => s && !knownNames.has(s.toLowerCase())),
    ),
  ].slice(0, 5);

  return { cards, suggestedDomains };
}

let client: Anthropic | undefined;

export async function generateCards(input: GenerateInput): Promise<GenerateOutput> {
  if (process.env.MOCK_LLM === "1") return mockGenerate(input);

  const model = defaultModel();
  const schema = outputSchema(input.domains.map((d) => d.slug));
  client ??= new Anthropic(); // credentials come from ANTHROPIC_API_KEY (or an `ant auth login` profile)

  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
      // Extraction doesn't need deep reasoning; low effort keeps this fast and cheap.
      output_config: { effort: "low", format: zodOutputFormat(schema) },
      // If the safety classifier declines, let the API retry on a fallback model server-side.
      ...(supportsFallbacks(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  } catch (err) {
    throw toGenerationError(err);
  }

  if (response.stop_reason === "refusal") {
    throw new RefusalError(response.stop_details?.explanation ?? "The model declined to process this section");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new GenerationError("The model's response was cut off or malformed — will retry");
  }
  return sanitize(response.parsed_output, input.domains, input.existingQuestions, input.sourceRef);
}

export function toGenerationError(err: unknown): GenerationError {
  // With no credentials at all the SDK throws a plain Error (not an APIError) at request time.
  if (err instanceof Error && /could not resolve authentication method|api.?key/i.test(err.message) && !(err instanceof Anthropic.APIError)) {
    return new GenerationError("No Claude credentials found. Set ANTHROPIC_API_KEY in .env.local and restart.", false);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new GenerationError("Claude rejected the API key. Check ANTHROPIC_API_KEY.", false);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new GenerationError("Rate limited by the Claude API — try again in a minute.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new GenerationError(`Claude rejected the request: ${err.message}`, false);
  }
  if (err instanceof Anthropic.APIError) {
    return new GenerationError(`Claude API error (${err.status ?? "network"}): ${err.message}`);
  }
  return new GenerationError(err instanceof Error ? err.message : "Unknown error calling Claude");
}

/**
 * Deterministic stand-in used when MOCK_LLM=1 (tests, local demos). Not smart — it just
 * produces plausible cards from the text so the whole pipeline can be exercised for free.
 */
export function mockGenerate(input: GenerateInput): GenerateOutput {
  const lower = input.text.toLowerCase();
  const scored = input.domains
    .map((d) => ({ d, n: lower.split(d.name.toLowerCase()).length - 1 + lower.split(d.slug).length - 1 }))
    .sort((a, b) => b.n - a.n);
  const tags = scored.filter((s) => s.n > 0).slice(0, 2).map((s) => s.d.slug);
  const domainSlugs = tags.length ? tags : input.domains.slice(0, 1).map((d) => d.slug);

  const sentences = input.text
    .replace(/[#>*`]/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 300);

  const cards: NewCard[] = sentences.slice(0, 4).map((s, i) =>
    i % 2 === 0
      ? { kind: "qa", question: `What is the key idea behind: "${s.slice(0, 60)}…"?`, body: s, domainSlugs, sourceRef: input.sourceRef }
      : { kind: "note", question: null, body: `**Takeaway:** ${s}`, domainSlugs, sourceRef: input.sourceRef },
  );
  const seen = new Set(input.existingQuestions.map(normalizeForDedupe));
  return {
    cards: cards.filter((c) => !seen.has(normalizeForDedupe(c.question ?? c.body))),
    suggestedDomains: lower.includes("kubernetes") && !domainSlugs.includes("kubernetes") ? ["Kubernetes"] : [],
  };
}
