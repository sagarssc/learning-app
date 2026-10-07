"use client";

import { useState } from "react";
import type { DomainDTO, FeedCard } from "@/lib/types";

type Props = {
  card: FeedCard;
  domains: DomainDTO[];
  onClose: () => void;
  onSave: (domainIds: string[]) => void;
};

/** Bottom sheet for editing which domains a card belongs to. */
export function TagSheet({ card, domains, onClose, onSave }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(card.domains.map((d) => d.id)));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Edit domains"
        className="w-full rounded-t-3xl border-t border-white/10 bg-zinc-900 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <h2 className="mb-1 text-lg font-semibold">Domains</h2>
        <p className="mb-4 line-clamp-2 text-sm text-zinc-400">{card.question ?? card.body}</p>
        <div className="mb-5 flex flex-wrap gap-2">
          {domains.map((d) => {
            const on = selected.has(d.id);
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(d.id)}
                style={on ? { backgroundColor: d.color, borderColor: d.color } : undefined}
                className={`rounded-full border px-3.5 py-2 text-sm font-medium transition ${
                  on ? "text-white" : "border-white/15 bg-white/5 text-zinc-300"
                }`}
              >
                {d.name}
              </button>
            );
          })}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/15 py-3 font-medium text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave([...selected])}
            className="flex-1 rounded-xl bg-indigo-500 py-3 font-medium text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
