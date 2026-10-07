"use client";

import { useCallback, useEffect, useState } from "react";
import type { DomainDTO } from "@/lib/types";

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#a855f7", "#14b8a6", "#ef4444", "#06b6d4", "#84cc16", "#f97316"];

async function call(url: string, method: string, body?: object) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function DomainsManager() {
  const [domains, setDomains] = useState<DomainDTO[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/domains", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ domains: DomainDTO[] }>) : Promise.reject(r.status)))
      .then((d) => {
        if (cancelled) return;
        setDomains(d.domains);
        setLoadError(false);
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [version]);

  /** Run a mutation, surface any error, and refresh the list. */
  async function act(fn: () => Promise<unknown>) {
    setMessage(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (loadError) return <p className="text-zinc-400">Couldn’t load domains.</p>;
  if (!domains) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div className="space-y-4">
      <AddForm onAdd={(body) => act(() => call("/api/domains", "POST", body))} nextColor={COLORS[domains.length % COLORS.length]} />
      {message && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {message}
        </p>
      )}
      <ul className="space-y-3">
        {domains.map((d) => (
          <DomainRow
            key={d.id}
            domain={d}
            others={domains.filter((o) => o.id !== d.id)}
            onSave={(patch) => act(() => call(`/api/domains/${d.id}`, "PATCH", patch))}
            onDelete={() => {
              const note = d.cardCount ? ` ${d.cardCount} cards will lose this tag (the cards stay).` : "";
              if (window.confirm(`Delete “${d.name}”?${note}`)) void act(() => call(`/api/domains/${d.id}`, "DELETE"));
            }}
            onMerge={(intoId, intoName) => {
              if (window.confirm(`Merge “${d.name}” into “${intoName}”? This can’t be undone.`)) {
                void act(() => call(`/api/domains/${d.id}/merge`, "POST", { intoId }));
              }
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function AddForm({ onAdd, nextColor }: { onAdd: (b: { name: string; color: string; description: string }) => Promise<void>; nextColor: string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await onAdd({ name: name.trim(), color: color ?? nextColor, description: description.trim() });
        setName("");
        setDescription("");
        setColor(null);
      }}
      className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4"
    >
      <div className="flex gap-2">
        <input
          type="color"
          aria-label="Color"
          value={color ?? nextColor}
          onChange={(e) => setColor(e.target.value)}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 p-1"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="New domain, e.g. Kubernetes"
          className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 outline-none focus:border-indigo-400"
        />
        <button type="submit" disabled={!name.trim()} className="shrink-0 rounded-xl bg-indigo-500 px-4 font-medium text-white disabled:opacity-40">
          Add
        </button>
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={300}
        placeholder="What belongs here? (helps Claude tag cards correctly)"
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm outline-none focus:border-indigo-400"
      />
    </form>
  );
}

function DomainRow({
  domain: d,
  others,
  onSave,
  onDelete,
  onMerge,
}: {
  domain: DomainDTO;
  others: DomainDTO[];
  onSave: (patch: { name: string; color: string; description: string }) => Promise<void>;
  onDelete: () => void;
  onMerge: (intoId: string, intoName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const [color, setColor] = useState(d.color);
  const [description, setDescription] = useState(d.description);

  if (editing) {
    return (
      <li className="space-y-3 rounded-2xl border border-indigo-400/40 bg-white/5 p-4">
        <div className="flex gap-2">
          <input type="color" aria-label="Color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 p-1" />
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Name" className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 outline-none focus:border-indigo-400" />
        </div>
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} aria-label="Description" placeholder="Description" className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm outline-none focus:border-indigo-400" />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              await onSave({ name: name.trim() || d.name, color, description: description.trim() });
              setEditing(false);
            }}
            className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white"
          >
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-white/15 px-4 py-2 text-sm text-zinc-200">
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-3">
        <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} aria-hidden />
        <h2 className="min-w-0 flex-1 truncate font-medium text-white">{d.name}</h2>
        <span className="shrink-0 text-sm tabular-nums text-zinc-500">
          {d.cardCount} card{d.cardCount === 1 ? "" : "s"}
        </span>
      </div>
      {d.description && <p className="mt-1.5 text-sm text-zinc-400">{d.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => setEditing(true)} className="rounded-lg bg-white/10 px-3 py-1.5">
          Edit
        </button>
        {others.length > 0 && (
          <select
            aria-label={`Merge ${d.name} into`}
            value=""
            onChange={(e) => {
              const target = others.find((o) => o.id === e.target.value);
              if (target) onMerge(target.id, target.name);
            }}
            className="rounded-lg bg-white/10 px-2 py-1.5 text-zinc-200"
          >
            <option value="">Merge into…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={onDelete} className="ml-auto rounded-lg px-3 py-1.5 text-zinc-500 hover:bg-white/10 hover:text-red-300">
          Delete
        </button>
      </div>
    </li>
  );
}
