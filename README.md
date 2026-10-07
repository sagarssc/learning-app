# Learning Reels

A personal study app. Drop in a **link, PDF, or pasted text** and Claude turns it into **Q&A cards and short notes**, which you swipe through like reels. Every card is tagged with one or more **domains** (Python, Node, MySQL, HLD, LLD, AI Engineering, LLM, … — you manage the list), and you can filter the feed by domain.

- **Swipe feed** — vertical scroll-snap (swipe up = next, down = previous; ↑/↓ or J/K on desktop), tap to reveal answers, star, edit tags, delete. Position is remembered per filter.
- **Domains** — Claude picks 1–3 per card from *your* list; you can edit any card's tags, and add/rename/merge/delete domains. If a source covers something you have no domain for, Claude suggests one (one tap to add).
- **Library** — everything you've imported, with progress, retry, and "view this resource's cards".
- **Installable PWA** — add it to your phone's home screen.

## Run it locally (no accounts needed)

```bash
npm install
npm run dev          # http://localhost:3000
```

With no `DATABASE_URL`, the app uses an embedded Postgres (PGlite) stored in `.data/` — migrations and the default domains are applied automatically.

> **Heads up:** once `DATABASE_URL` is in `.env.local` (e.g. after `neon link`), `npm run dev` talks to that Neon database — the same one a deployed copy would use, so your cards show up everywhere, but dev experiments are real data too. To go back to the throwaway local database, comment that line out. `npm test` always uses an in-memory database and ignores `DATABASE_URL`.

To generate cards with Claude, create `.env.local` (see `.env.example`):

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

No key yet? Set `MOCK_LLM=1` to exercise the whole pipeline with fake cards, free. (On a fresh install the empty feed also has a **Load demo cards** button in dev.)

### Model & cost

`CLAUDE_MODEL` defaults to `claude-opus-5-5`. Setting `CLAUDE_MODEL=claude-sonnet-5-5` is cheaper (roughly half the per-token price). Each ~6K-token section of a source is one Claude call, run at low effort. Before processing a large import (> 6 sections) the app shows the size and waits for you to press Start.

## Deploy (Vercel + Neon + Blob)

You need to create these yourself — they're account-level actions:

1. **Neon** Postgres → copy the pooled connection string into `DATABASE_URL`.
2. **Vercel project** from this repo, then add a **Blob** store (gives `BLOB_READ_WRITE_TOKEN`; enables PDFs larger than 4 MB and keeps the original file).
3. Set environment variables in Vercel: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `APP_PASSWORD` (your passphrase), `SESSION_SECRET` (`openssl rand -base64 48`), optional `CLAUDE_MODEL`.
4. Apply the schema once: `DATABASE_URL=… npm run db:migrate` (also seeds the default domains).
5. Open the site → log in → **Share → Add to Home Screen** on your phone.

In production the app refuses to start without `DATABASE_URL`, and refuses all requests without a valid session, because a public deployment would otherwise let anyone spend your Claude credits.

## How it works

```
Add (link / PDF / text)
  → fetch + extract text   SSRF-guarded fetch, Readability, unpdf
  → chunk (~6K tokens)     split on headings / pages, stored as rows
  → one Claude call per chunk, driven by the browser   (state lives in the DB, so it's resumable)
  → validate + dedupe → cards + domain tags
```

- `src/lib/ingest/` — fetch (with SSRF protection and size caps), HTML→markdown, PDF text, chunking
- `src/lib/ai/` — prompt, structured-output schema, output validation, mock generator
- `src/lib/pipeline.ts` — atomic chunk claiming, idempotent card inserts, retry/skip/fail handling
- `src/components/feed/` — the swipe feed
- `src/proxy.ts` — login gate (Next.js 16 renamed `middleware` to `proxy`)

## Scripts

| | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | unit + integration tests (in-memory Postgres, mocked Claude) |
| `npm run lint` | ESLint |
| `npm run db:generate` | generate a SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | apply migrations + seed domains to `DATABASE_URL` |
| `node scripts/make-icons.mjs` | regenerate the PWA icons |

## Known limits

- **Domain/kind values are enforced after the fact.** The Claude call has been verified live (structured output, tags, suggested domains), but this SDK version sends only a subset of the JSON schema — it turns `enum` into a description hint — so `sanitize()` enforces the allowed values rather than the API.
- **Scanned PDFs** (images only) aren't supported — there's no OCR. You get a clear error.
- **JavaScript-rendered or login-walled pages** can't be read; paste the text instead.
- **Uploaded PDFs on Vercel Blob are public** (unguessable URL, but not private).
- **SSRF guard resolves DNS before fetching**, so a hostile DNS server could rebind in between. Acceptable for a single-user app behind a login.
- Function duration: processing one section can take a while; the route sets `maxDuration = 300`, so check that your Vercel plan allows it.
- Single shared passphrase, no per-user accounts.
