"use client";

import type { DomainDTO } from "@/lib/types";
import { ShuffleIcon, StarIcon } from "@/components/icons";

type Props = {
  domains: DomainDTO[];
  selected: string[];
  onToggleDomain: (slug: string) => void;
  onClear: () => void;
  shuffle: boolean;
  onToggleShuffle: () => void;
  starredOnly: boolean;
  onToggleStarred: () => void;
};

export function DomainBar({
  domains,
  selected,
  onToggleDomain,
  onClear,
  shuffle,
  onToggleShuffle,
  starredOnly,
  onToggleStarred,
}: Props) {
  // Hide domains with no cards (they're still manageable on /domains), but never hide a selected one.
  const visible = domains.filter((d) => d.cardCount > 0 || selected.includes(d.slug));

  return (
    <div className="pointer-events-auto flex items-center gap-2 bg-gradient-to-b from-black/80 via-black/50 to-transparent px-3 pb-6 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <div className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">
        <Chip active={selected.length === 0} onClick={onClear}>
          All
        </Chip>
        {visible.map((d) => (
          <Chip
            key={d.id}
            active={selected.includes(d.slug)}
            color={d.color}
            onClick={() => onToggleDomain(d.slug)}
          >
            {d.name}
          </Chip>
        ))}
      </div>
      <IconToggle label="Shuffle" active={shuffle} onClick={onToggleShuffle}>
        <ShuffleIcon width={18} height={18} />
      </IconToggle>
      <IconToggle label="Starred only" active={starredOnly} onClick={onToggleStarred}>
        <StarIcon width={18} height={18} filled={starredOnly} />
      </IconToggle>
    </div>
  );
}

function Chip({
  children,
  active,
  color,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={active && color ? { backgroundColor: color, borderColor: color } : undefined}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? `${color ? "text-white" : "border-white bg-white text-black"}`
          : "border-white/15 bg-white/10 text-zinc-200 hover:bg-white/15"
      }`}
    >
      {color && !active && (
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      )}
      {children}
    </button>
  );
}

function IconToggle({
  children,
  active,
  label,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-9 shrink-0 items-center justify-center rounded-full border transition ${
        active ? "border-amber-300 bg-amber-300 text-black" : "border-white/15 bg-white/10 text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
