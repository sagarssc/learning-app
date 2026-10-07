"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcessResult } from "@/lib/pipeline";

type Phase = "idle" | "running" | "error" | "done";

type Props = {
  resourceId: string;
  /** Start immediately on mount (otherwise show a Start button). */
  autoStart?: boolean;
  chunksTotal: number;
  chunksDone?: number;
  onFinished?: (result: ProcessResult) => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drives a resource through Claude one section at a time by calling the process endpoint in a
 * loop. State lives in the database, so closing the tab just pauses it — remounting resumes.
 */
export function ResourceProgress({ resourceId, autoStart, chunksTotal, chunksDone = 0, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>(autoStart ? "running" : "idle");
  const [done, setDone] = useState(chunksDone);
  const [total, setTotal] = useState(chunksTotal);
  const [cards, setCards] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Each run gets a token; unmounting (or starting a newer run) invalidates older loops.
  const runToken = useRef(0);

  const loop = useCallback(async () => {
    const token = ++runToken.current;
    const alive = () => runToken.current === token;
    let networkFailures = 0;

    while (alive()) {
      let result: ProcessResult;
      try {
        const res = await fetch(`/api/resources/${resourceId}/process`, { method: "POST" });
        if (!res.ok) throw new Error(res.status === 401 ? "Signed out — reload and log in again" : `Server error (${res.status})`);
        result = await res.json();
        networkFailures = 0;
      } catch (err) {
        // Brief network blips shouldn't abort a long import; give up after a few in a row.
        if (++networkFailures < 3) {
          await sleep(2000);
          continue;
        }
        setError(err instanceof Error ? err.message : "Network error");
        setPhase("error");
        break;
      }

      if (!alive()) break;
      setDone(result.chunksDone);
      setTotal(result.chunksTotal);
      setCards((n) => n + result.cardsAdded);

      if (result.error) {
        setError(result.error);
        setPhase("error");
        break;
      }
      if (result.finished) {
        setPhase("done");
        onFinished?.(result);
        break;
      }
      if (result.busy) await sleep(3000); // another tab/request is on the last section
    }
  }, [resourceId, onFinished]);

  /** Start (or resume) from a click: show the running state, then loop. */
  const start = useCallback(() => {
    setPhase("running");
    setError(null);
    void loop();
  }, [loop]);

  const stop = useCallback(() => {
    runToken.current++; // invalidates any loop in flight
  }, []);

  useEffect(() => {
    // loop() only sets state after awaiting the network (never synchronously), and `phase`
    // already starts as "running" when autoStart is set — so this can't cascade renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (autoStart) void loop();
    return stop; // stop the loop when leaving the page
  }, [autoStart, loop, stop]);

  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      {phase === "idle" && (
        <button type="button" onClick={start} className="w-full rounded-xl bg-indigo-500 py-3 font-medium text-white">
          {done > 0 ? "Resume" : "Start"} — {total - done} section{total - done === 1 ? "" : "s"} to go
        </button>
      )}

      {phase === "running" && (
        <>
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-zinc-200">Reading with Claude…</span>
            <span className="tabular-nums text-zinc-400">
              {done}/{total}
            </span>
          </div>
          <Bar pct={pct} />
          <p className="mt-2 text-xs text-zinc-500">
            {cards > 0 ? `${cards} cards made so far. ` : ""}You can leave this page — it picks up where it stopped.
          </p>
        </>
      )}

      {phase === "error" && (
        <>
          <p className="mb-3 text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={async () => {
              await fetch(`/api/resources/${resourceId}/retry`, { method: "POST" }).catch(() => {});
              start();
            }}
            className="w-full rounded-xl bg-white/10 py-2.5 font-medium"
          >
            Try again
          </button>
        </>
      )}

      {phase === "done" && (
        <>
          <Bar pct={100} />
          <p className="mt-3 text-sm text-zinc-200">
            Done{cards > 0 ? ` — ${cards} new cards` : ""}.
          </p>
          <Link href="/" className="mt-3 block rounded-xl bg-indigo-500 py-3 text-center font-medium text-white">
            Start swiping
          </Link>
        </>
      )}
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-indigo-400 transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}
