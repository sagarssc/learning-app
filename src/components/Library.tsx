"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ResourceProgress } from "@/components/ResourceProgress";
import type { ResourceDTO } from "@/lib/types";

const TYPE_LABEL = { url: "Link", pdf: "PDF", text: "Text" } as const;

export function Library() {
  const [items, setItems] = useState<ResourceDTO[] | null>(null);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []); // refetch

  useEffect(() => {
    let cancelled = false;
    fetch("/api/resources", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ resources: ResourceDTO[] }>) : Promise.reject(r.status)))
      .then((d) => {
        if (cancelled) return;
        setItems(d.resources);
        setError(false);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (error) {
    return (
      <p className="text-zinc-400">
        Couldn’t load your library.{" "}
        <button type="button" onClick={load} className="text-indigo-300 underline">
          Retry
        </button>
      </p>
    );
  }
  if (!items) return <p className="text-zinc-500">Loading…</p>;
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-700 p-8 text-center text-zinc-400">
        <p className="mb-4">Nothing here yet.</p>
        <Link href="/add" className="rounded-xl bg-indigo-500 px-5 py-2.5 font-medium text-white">
          Add your first resource
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((r) => (
        <ResourceRow key={r.id} resource={r} onChanged={load} />
      ))}
    </ul>
  );
}

function ResourceRow({ resource: r, onChanged }: { resource: ResourceDTO; onChanged: () => void }) {
  const href = r.sourceUrl ?? r.blobUrl;
  const inFlight = r.status === "queued" || r.status === "processing";

  async function remove() {
    if (!window.confirm(`Delete “${r.title}” and its ${r.cardCount} cards?`)) return;
    await fetch(`/api/resources/${r.id}`, { method: "DELETE" });
    onChanged();
  }

  async function retry() {
    await fetch(`/api/resources/${r.id}/retry`, { method: "POST" });
    onChanged();
  }

  async function acceptSuggestion(name: string) {
    const res = await fetch("/api/domains", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok || res.status === 409) await dismissSuggestion(name); // 409 = it already exists
  }

  async function dismissSuggestion(name: string) {
    await fetch(`/api/resources/${r.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dismissSuggestion: name }),
    });
    onChanged();
  }

  return (
    <li className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            <span>{TYPE_LABEL[r.type]}</span>
            <span>·</span>
            <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleDateString()}</time>
            <StatusBadge status={r.status} />
          </div>
          <h2 className="line-clamp-2 font-medium text-white">{r.title}</h2>
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-zinc-500 hover:text-zinc-300">
              {href}
            </a>
          )}
        </div>
        <button type="button" onClick={remove} aria-label={`Delete ${r.title}`} className="shrink-0 rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-white/10 hover:text-red-300">
          Delete
        </button>
      </div>

      {r.domains.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {r.domains.map((d) => (
            <span
              key={d.id}
              className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: `${d.color}2e`, borderColor: `${d.color}80` }}
            >
              {d.name}
            </span>
          ))}
        </div>
      )}

      {r.status === "ready" && (
        <Link
          href={`/?resource=${r.id}`}
          className="mt-3 inline-block rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white"
        >
          View {r.cardCount} card{r.cardCount === 1 ? "" : "s"}
        </Link>
      )}

      {inFlight && (
        <div className="mt-3">
          <ResourceProgress resourceId={r.id} chunksTotal={r.chunksTotal} chunksDone={r.chunksDone} onFinished={onChanged} />
        </div>
      )}

      {r.status === "failed" && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-red-300">{r.error ?? "This one didn’t work."}</p>
          <button type="button" onClick={retry} className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium">
            Try again
          </button>
        </div>
      )}

      {r.suggestedDomains.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <p className="mb-2 text-xs text-zinc-500">Claude thinks this also covers topics you don’t have a domain for:</p>
          <div className="flex flex-wrap gap-2">
            {r.suggestedDomains.map((name) => (
              <span key={name} className="inline-flex overflow-hidden rounded-full border border-dashed border-zinc-500 text-xs">
                <button type="button" onClick={() => acceptSuggestion(name)} className="px-3 py-1 text-zinc-200 hover:bg-white/10">
                  + Add “{name}”
                </button>
                <button type="button" onClick={() => dismissSuggestion(name)} aria-label={`Dismiss ${name}`} className="border-l border-dashed border-zinc-500 px-2 text-zinc-500 hover:bg-white/10">
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: ResourceDTO["status"] }) {
  const style = {
    ready: "text-emerald-400",
    failed: "text-red-400",
    processing: "text-amber-300",
    queued: "text-amber-300",
  }[status];
  return <span className={`ml-auto ${style}`}>{status}</span>;
}
