"use client";

import type { FeedCard } from "@/lib/types";
import { InlineMarkdown, Markdown } from "@/components/Markdown";
import { LinkIcon, StarIcon, TagIcon, TrashIcon } from "@/components/icons";

type Props = {
  card: FeedCard;
  position: string;
  /** A banner (e.g. "From: …") is overlaying the top of the feed; leave room for it. */
  hasBanner?: boolean;
  revealed: boolean;
  onToggleReveal: () => void;
  onToggleStar: () => void;
  onEditTags: () => void;
  onDelete: () => void;
  onPickDomain: (slug: string) => void;
};

export function CardSlide({
  card,
  position,
  hasBanner,
  revealed,
  onToggleReveal,
  onToggleStar,
  onEditTags,
  onDelete,
  onPickDomain,
}: Props) {
  const accent = card.domains[0]?.color ?? "#6366f1";
  const sourceHref = card.resource.sourceUrl ?? card.resource.blobUrl;
  const isQa = card.kind === "qa";

  return (
    <article
      className={`relative flex h-full flex-col px-5 pb-5 ${
        hasBanner ? "pt-[calc(env(safe-area-inset-top)+7rem)]" : "pt-[calc(env(safe-area-inset-top)+4.5rem)]"
      }`}
      style={{ background: `radial-gradient(120% 55% at 50% 0%, ${accent}30, transparent 70%)` }}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 pr-14">
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
          {isQa ? "Q&A" : "Note"}
        </span>
        {card.domains.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onPickDomain(d.slug)}
            style={{ backgroundColor: `${d.color}2e`, borderColor: `${d.color}80`, color: "#fff" }}
            className="rounded-full border px-2.5 py-0.5 text-xs font-medium"
          >
            {d.name}
          </button>
        ))}
        {card.domains.length === 0 && <span className="text-xs text-zinc-500">untagged</span>}
      </div>

      {/* Content scrolls on its own if a long answer overflows; swipes past its end move the feed. */}
      <div
        className={`no-scrollbar min-h-0 flex-1 overflow-y-auto pr-14 ${isQa ? "cursor-pointer" : ""}`}
        onClick={(e) => {
          if (!isQa || (e.target as HTMLElement).closest("a,button")) return;
          onToggleReveal();
        }}
      >
        {isQa ? (
          <>
            <h2 className="text-[1.65rem] font-semibold leading-snug text-white">
              <InlineMarkdown>{card.question ?? ""}</InlineMarkdown>
            </h2>
            {revealed ? (
              <div className="mt-6 border-t border-white/10 pt-5">
                <Markdown>{card.body}</Markdown>
              </div>
            ) : (
              <button
                type="button"
                onClick={onToggleReveal}
                className="mt-8 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-medium text-zinc-100"
              >
                Tap to reveal answer
              </button>
            )}
          </>
        ) : (
          <Markdown className="text-[1.1rem]">{card.body}</Markdown>
        )}
      </div>

      <footer className="mt-3 flex items-center justify-between gap-3 pr-14 text-xs text-zinc-500">
        <span className="min-w-0 truncate">
          {card.resource.title}
          {card.sourceRef ? ` · ${card.sourceRef}` : ""}
        </span>
        <span className="shrink-0 tabular-nums">{position}</span>
      </footer>

      <div className="absolute bottom-16 right-3 z-10 flex flex-col items-center gap-4">
        <RailButton label={card.starred ? "Unstar" : "Star"} onClick={onToggleStar} active={card.starred}>
          <StarIcon filled={card.starred} />
        </RailButton>
        <RailButton label="Edit domains" onClick={onEditTags}>
          <TagIcon />
        </RailButton>
        {sourceHref && (
          <a
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open source"
            className="flex size-11 items-center justify-center rounded-full bg-white/10 text-zinc-100 backdrop-blur"
          >
            <LinkIcon />
          </a>
        )}
        <RailButton label="Delete card" onClick={onDelete}>
          <TrashIcon />
        </RailButton>
      </div>
    </article>
  );
}

function RailButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex size-11 items-center justify-center rounded-full backdrop-blur transition active:scale-90 ${
        active ? "bg-amber-300 text-black" : "bg-white/10 text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}
