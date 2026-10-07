"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { ResourceProgress } from "@/components/ResourceProgress";

type Mode = "url" | "pdf" | "text";
type Created = { id: string; duplicate: boolean; title: string; chunks: number; estimatedInputTokens: number };

/** More sections than this and we ask before spending Claude credits. */
const AUTO_START_MAX_CHUNKS = 6;

const TABS: { mode: Mode; label: string }[] = [
  { mode: "url", label: "Link" },
  { mode: "pdf", label: "PDF" },
  { mode: "text", label: "Paste text" },
];

export function AddResource() {
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const canSubmit =
    !busy && ((mode === "url" && url.trim()) || (mode === "text" && text.trim().length > 0) || (mode === "pdf" && file));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await send();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status})`);
      setCreated(data as Created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  function send(): Promise<Response> {
    const json = (body: object) =>
      fetch("/api/resources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    if (mode === "url") {
      setStatus("Fetching the page…");
      return json({ type: "url", url });
    }
    if (mode === "text") {
      setStatus("Reading your text…");
      return json({ type: "text", title: title || undefined, text });
    }
    return sendPdf(file!, json);
  }

  async function sendPdf(f: File, json: (b: object) => Promise<Response>): Promise<Response> {
    const config = await fetch("/api/config", { cache: "no-store" }).then((r) => r.json());
    if (config.blobEnabled) {
      // Straight to Vercel Blob: no request-size limit, and we keep the original PDF.
      setStatus("Uploading PDF…");
      const blob = await upload(f.name, f, { access: "public", handleUploadUrl: "/api/upload" });
      setStatus("Reading the PDF…");
      return json({ type: "pdf", blobUrl: blob.url, filename: f.name });
    }
    setStatus("Reading the PDF…");
    const form = new FormData();
    form.append("file", f);
    return fetch("/api/resources", { method: "POST", body: form });
  }

  function reset() {
    setCreated(null);
    setUrl("");
    setText("");
    setTitle("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  if (created) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="font-medium text-white">{created.title}</p>
          <p className="mt-1 text-sm text-zinc-400">
            {created.duplicate ? "You already added this one. " : ""}
            {created.chunks} section{created.chunks === 1 ? "" : "s"} · about{" "}
            {created.estimatedInputTokens < 1000 ? "under 1K" : `${Math.round(created.estimatedInputTokens / 1000)}K`}{" "}
            tokens to read
          </p>
        </div>
        <ResourceProgress
          resourceId={created.id}
          chunksTotal={created.chunks}
          autoStart={created.chunks <= AUTO_START_MAX_CHUNKS}
        />
        <div className="flex gap-3 text-sm">
          <button type="button" onClick={reset} className="rounded-xl border border-white/15 px-4 py-2 text-zinc-200">
            Add another
          </button>
          <Link href="/library" className="rounded-xl border border-white/15 px-4 py-2 text-zinc-200">
            Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">
        {TABS.map((t) => (
          <button
            key={t.mode}
            type="button"
            role="tab"
            aria-selected={mode === t.mode}
            onClick={() => {
              setMode(t.mode);
              setError(null);
            }}
            className={`rounded-lg py-2 text-sm font-medium transition ${
              mode === t.mode ? "bg-white text-black" : "text-zinc-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === "url" && (
        <input
          type="url"
          inputMode="url"
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… article, docs page, or PDF link"
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-indigo-400"
        />
      )}

      {mode === "pdf" && (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-600 bg-zinc-900/50 px-4 py-8 text-center transition hover:border-indigo-400">
          <span className="font-medium text-zinc-200">{file ? file.name : "Choose a PDF"}</span>
          <span className="text-sm text-zinc-500">
            {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "Text-based PDFs only (scans aren't supported yet)"}
          </span>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}

      {mode === "text" && (
        <>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-indigo-400"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="Paste notes, an article, or a chapter…"
            className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-indigo-400"
          />
        </>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-xl bg-indigo-500 py-3 font-medium text-white transition disabled:opacity-40"
      >
        {busy ? (status ?? "Working…") : "Create cards"}
      </button>
      <p className="text-center text-xs text-zinc-500">
        Claude reads it in sections and tags each card with your domains.
      </p>
    </form>
  );
}
