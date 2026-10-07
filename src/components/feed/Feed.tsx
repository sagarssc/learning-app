"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CardsPage, DomainDTO, FeedCard } from "@/lib/types";
import { CardSlide } from "./CardSlide";
import { DomainBar } from "./DomainBar";
import { TagSheet } from "./TagSheet";

const PAGE_SIZE = 20;
const MAX_RESTORE = 200; // server caps `limit` at 200
const RENDER_WINDOW = 2; // slides kept mounted on each side of the active one
const PREFETCH_AHEAD = 6;

type Filter = { domains: string; mode: "seq" | "shuffle"; seed: string; starred: boolean; resource: string };
type Status = "loading" | "ready" | "error";

function cardsUrl(f: Filter, offset: number, limit: number) {
  const p = new URLSearchParams({ mode: f.mode, offset: String(offset), limit: String(limit) });
  if (f.domains) p.set("domain", f.domains);
  if (f.mode === "shuffle") p.set("seed", f.seed || "default");
  if (f.starred) p.set("starred", "1");
  if (f.resource) p.set("resource", f.resource);
  return `/api/cards?${p}`;
}

const posKey = (f: Filter) =>
  `lr:pos:${f.domains}|${f.mode}|${f.mode === "shuffle" ? f.seed : ""}|${f.starred}|${f.resource}`;

function readPos(f: Filter): number {
  try {
    const n = Number(localStorage.getItem(posKey(f)));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writePos(f: Filter, index: number) {
  try {
    localStorage.setItem(posKey(f), String(index));
  } catch {
    /* storage unavailable (private mode) — position just won't persist */
  }
}

export function Feed() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const domainParam = searchParams.get("domain") ?? "";
  const mode = searchParams.get("mode") === "shuffle" ? "shuffle" : "seq";
  const seed = searchParams.get("seed") ?? "";
  const starredOnly = searchParams.get("starred") === "1";
  const resourceId = searchParams.get("resource") ?? "";
  const filter = useMemo<Filter>(
    () => ({ domains: domainParam, mode, seed, starred: starredOnly, resource: resourceId }),
    [domainParam, mode, seed, starredOnly, resourceId],
  );
  const selected = useMemo(() => (domainParam ? domainParam.split(",") : []), [domainParam]);

  const [cards, setCards] = useState<FeedCard[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [active, setActive] = useState(0);
  const [domains, setDomains] = useState<DomainDTO[]>([]);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [tagTarget, setTagTarget] = useState<FeedCard | null>(null);
  const [resourceTitle, setResourceTitle] = useState<{ id: string; title: string } | null>(null);
  const [reloadToken, setReloadToken] = useState(0); // bump to refetch the feed itself
  const [domainsVersion, setDomainsVersion] = useState(0); // bump to refresh domain chips/counts only

  const scrollRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const generation = useRef(0); // bumps on every filter change; stale responses are dropped
  const loadingMore = useRef(false);
  const restoreTo = useRef<number | null>(null);
  const positionTracking = useRef(false); // false until the saved position has been restored

  // When the filter changes, drop the old cards immediately (adjusting state during render is
  // React's recommended alternative to resetting it from an effect).
  const filterKey = posKey(filter);
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setStatus("loading");
    setCards([]);
    setActive(0);
    setRevealed(new Set());
  }

  /** Refetch the feed from scratch (retry, after loading demo data, after a failed delete). */
  const reload = useCallback(() => {
    setStatus("loading");
    setCards([]);
    setActive(0);
    setRevealed(new Set());
    setReloadToken((n) => n + 1);
  }, []);

  const setQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Domains for the filter bar and the tag editor.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/domains", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { domains: DomainDTO[] }) => !cancelled && setDomains(d.domains))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [domainsVersion]);

  // Name of the resource being viewed (for the banner) when filtering to a single one.
  useEffect(() => {
    if (!resourceId) return;
    let cancelled = false;
    fetch(`/api/resources/${resourceId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { resource: { title: string } }) => !cancelled && setResourceTitle({ id: resourceId, title: d.resource.title }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  // First page (or filter change). Loads enough to reach the saved position in one request.
  useEffect(() => {
    const gen = ++generation.current;
    positionTracking.current = false;
    loadingMore.current = false;

    const saved = readPos(filter);
    const limit = Math.min(Math.max(saved + PAGE_SIZE, PAGE_SIZE), MAX_RESTORE);
    fetch(cardsUrl(filter, 0, limit), { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<CardsPage>) : Promise.reject(r.status)))
      .then((page) => {
        if (gen !== generation.current) return;
        restoreTo.current = Math.min(saved, Math.max(page.cards.length - 1, 0));
        setCards(page.cards);
        setHasMore(page.hasMore);
        setStatus("ready");
      })
      .catch(() => gen === generation.current && setStatus("error"));
  }, [filter, reloadToken]);

  // Jump to the saved slide once the first page is in the DOM.
  useEffect(() => {
    const el = scrollRef.current;
    if (status !== "ready" || !el) return;
    const target = restoreTo.current ?? 0;
    restoreTo.current = null;
    if (target > 0) {
      el.scrollTo({ top: target * el.clientHeight, behavior: "instant" as ScrollBehavior });
      setActive(target);
    }
    positionTracking.current = true;
  }, [status]);

  // Track which slide is on screen. Slides are exactly viewport-high, so ≥60% visible means "current".
  useEffect(() => {
    const root = scrollRef.current;
    if (status !== "ready" || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          setActive(index);
          if (positionTracking.current) writePos(filter, index);
        }
      },
      { root, threshold: 0.6 },
    );
    slideRefs.current.slice(0, cards.length + 1).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [status, cards.length, filter]);

  // Prefetch the next page as the user nears the end of what's loaded.
  useEffect(() => {
    if (status !== "ready" || !hasMore || loadingMore.current) return;
    if (active < cards.length - PREFETCH_AHEAD) return;
    loadingMore.current = true;
    const gen = generation.current;
    fetch(cardsUrl(filter, cards.length, PAGE_SIZE), { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<CardsPage>) : Promise.reject(r.status)))
      .then((page) => {
        if (gen !== generation.current) return;
        setCards((prev) => {
          const have = new Set(prev.map((c) => c.id));
          return [...prev, ...page.cards.filter((c) => !have.has(c.id))];
        });
        setHasMore(page.hasMore);
      })
      .catch(() => {})
      .finally(() => {
        loadingMore.current = false;
      });
  }, [active, cards.length, hasMore, status, filter]);

  // Mark a card as seen after the user dwells on it for a moment.
  const activeId = cards[active]?.id;
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(() => {
      fetch(`/api/cards/${activeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seen: true }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [activeId]);

  const lastIndex = cards.length; // the "caught up" slide
  const goTo = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(index, lastIndex));
      el.scrollTo({ top: clamped * el.clientHeight, behavior: "smooth" });
    },
    [lastIndex],
  );

  const toggleReveal = useCallback((id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const patchCard = useCallback((id: string, body: object) => {
    return fetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
    });
  }, []);

  const toggleStar = useCallback(
    (card: FeedCard) => {
      const starred = !card.starred;
      const apply = (value: boolean) =>
        setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, starred: value } : c)));
      apply(starred);
      patchCard(card.id, { starred }).catch(() => apply(card.starred)); // roll back on failure
    },
    [patchCard],
  );

  const saveTags = useCallback(
    (card: FeedCard, domainIds: string[]) => {
      const tags = domains
        .filter((d) => domainIds.includes(d.id))
        .map(({ id, slug, name, color }) => ({ id, slug, name, color }));
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, domains: tags } : c)));
      setTagTarget(null);
      patchCard(card.id, { domainIds })
        .then(() => setDomainsVersion((n) => n + 1)) // refresh chip counts without reloading the feed
        .catch(() => setCards((prev) => prev.map((c) => (c.id === card.id ? card : c))));
    },
    [domains, patchCard],
  );

  const removeCard = useCallback(
    (card: FeedCard) => {
      if (!window.confirm("Delete this card?")) return;
      const index = cards.findIndex((c) => c.id === card.id);
      setCards((prev) => prev.filter((c) => c.id !== card.id));
      if (index !== -1 && index === cards.length - 1) setActive((a) => Math.max(0, a - 1));
      fetch(`/api/cards/${card.id}`, { method: "DELETE" }).catch(reload);
    },
    [cards, reload],
  );

  // Keyboard: ↑/↓ or k/j move, Space/Enter reveals, s stars.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (tagTarget || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const onControl = !!target?.closest("button,a");
      const card = cards[active];

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        goTo(active + 1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        goTo(active - 1);
      } else if ((e.key === " " || e.key === "Enter") && !onControl && card?.kind === "qa") {
        e.preventDefault();
        toggleReveal(card.id);
      } else if (e.key === "s" && card) {
        toggleStar(card);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, cards, goTo, tagTarget, toggleReveal, toggleStar]);

  const toggleDomain = (slug: string) => {
    const next = selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug];
    setQuery({ domain: next.length ? next.join(",") : null });
  };
  const toggleShuffle = () =>
    mode === "shuffle"
      ? setQuery({ mode: null, seed: null })
      : setQuery({ mode: "shuffle", seed: Math.random().toString(36).slice(2, 10) });
  const toggleStarred = () => setQuery({ starred: starredOnly ? null : "1" });
  const clearAll = () => setQuery({ domain: null, starred: null, resource: null });

  const filtered = selected.length > 0 || starredOnly || Boolean(resourceId);

  async function loadDemo() {
    await fetch("/api/dev/seed-demo", { method: "POST" });
    setDomainsVersion((n) => n + 1);
    reload();
  }

  return (
    <div className="absolute inset-0">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
        <DomainBar
          domains={domains}
          selected={selected}
          onToggleDomain={toggleDomain}
          onClear={clearAll}
          shuffle={mode === "shuffle"}
          onToggleShuffle={toggleShuffle}
          starredOnly={starredOnly}
          onToggleStarred={toggleStarred}
        />
        {resourceId && (
          <div className="pointer-events-auto -mt-3 flex items-center gap-2 px-3">
            <span className="min-w-0 truncate rounded-full bg-indigo-500/20 px-3 py-1 text-xs text-indigo-100">
              From: {resourceTitle?.id === resourceId ? resourceTitle.title : "this resource"}
            </span>
            <button
              type="button"
              onClick={() => setQuery({ resource: null })}
              className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs text-zinc-200"
            >
              Show all ✕
            </button>
          </div>
        )}
      </div>

      {status === "loading" && <Centered>Loading…</Centered>}

      {status === "error" && (
        <Centered>
          <p className="mb-4">Couldn’t load your cards.</p>
          <button
            type="button"
            onClick={reload}
            className="rounded-xl bg-indigo-500 px-5 py-2.5 font-medium text-white"
          >
            Retry
          </button>
        </Centered>
      )}

      {status === "ready" && cards.length === 0 && (
        <Centered>
          <p className="mb-1 text-lg font-medium text-white">
            {filtered ? "No cards match these filters" : "Nothing to study yet"}
          </p>
          <p className="mb-5 max-w-xs text-zinc-400">
            {filtered ? "Try a different domain." : "Add a PDF or a link and Claude will turn it into cards."}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {filtered ? (
              <button type="button" onClick={clearAll} className="rounded-xl bg-white/10 px-5 py-2.5 font-medium">
                Clear filters
              </button>
            ) : (
              <Link href="/add" className="rounded-xl bg-indigo-500 px-5 py-2.5 font-medium text-white">
                Add a resource
              </Link>
            )}
            {process.env.NODE_ENV !== "production" && !filtered && (
              <button type="button" onClick={loadDemo} className="rounded-xl bg-white/10 px-5 py-2.5 font-medium">
                Load demo cards
              </button>
            )}
          </div>
        </Centered>
      )}

      {status === "ready" && cards.length > 0 && (
        <div
          ref={scrollRef}
          className="no-scrollbar h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
        >
          {cards.map((card, i) => (
            <section
              key={card.id}
              data-index={i}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              className="h-full snap-start snap-always"
            >
              {Math.abs(i - active) <= RENDER_WINDOW && (
                <CardSlide
                  card={card}
                  position={`${i + 1}${hasMore ? "+" : ` / ${cards.length}`}`}
                  hasBanner={Boolean(resourceId)}
                  revealed={revealed.has(card.id)}
                  onToggleReveal={() => toggleReveal(card.id)}
                  onToggleStar={() => toggleStar(card)}
                  onEditTags={() => setTagTarget(card)}
                  onDelete={() => removeCard(card)}
                  onPickDomain={(slug) => setQuery({ domain: slug })}
                />
              )}
            </section>
          ))}
          <section
            data-index={lastIndex}
            ref={(el) => {
              slideRefs.current[lastIndex] = el;
            }}
            className="flex h-full snap-start snap-always flex-col items-center justify-center px-8 text-center"
          >
            {hasMore ? (
              <p className="text-zinc-400">Loading more…</p>
            ) : (
              <>
                <p className="mb-1 text-2xl font-semibold text-white">You’re all caught up</p>
                <p className="mb-6 text-zinc-400">{cards.length} cards in this view.</p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => goTo(0)}
                    className="rounded-xl bg-white/10 px-5 py-2.5 font-medium"
                  >
                    Back to top
                  </button>
                  <Link href="/add" className="rounded-xl bg-indigo-500 px-5 py-2.5 font-medium text-white">
                    Add more
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {tagTarget && (
        <TagSheet
          card={tagTarget}
          domains={domains}
          onClose={() => setTagTarget(null)}
          onSave={(ids) => saveTags(tagTarget, ids)}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center text-zinc-400">
      {children}
    </div>
  );
}
