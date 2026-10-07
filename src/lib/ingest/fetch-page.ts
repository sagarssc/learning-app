import { IngestError } from "./errors";
import { assertPublicHttpUrl } from "./ssrf";

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; LearningReels/1.0; personal study tool) AppleWebKit/537.36 (KHTML, like Gecko)";

export type Fetched = { url: URL; contentType: string; body: Uint8Array };

/**
 * Fetch a public web page or PDF safely: every hop (including redirects) is re-validated
 * against the SSRF rules, the response is size-capped while streaming, and the whole
 * request has a timeout.
 */
export async function fetchPublic(input: string): Promise<Fetched> {
  let url = await assertPublicHttpUrl(input);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        },
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new IngestError(timedOut ? "The site took too long to respond" : "Couldn't reach that site");
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new IngestError("The site sent a redirect with no destination");
      url = await assertPublicHttpUrl(new URL(location, url).toString());
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel();
      throw new IngestError(`The site returned an error (HTTP ${res.status})`);
    }

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) {
      await res.body?.cancel();
      throw new IngestError("That page is too large to import");
    }

    return {
      url,
      contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(),
      body: await readCapped(res),
    };
  }
  throw new IngestError("Too many redirects");
}

async function readCapped(res: Response): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new IngestError("That page is too large to import");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}
