"use client";

import { useEffect, useState } from "react";

interface Clock {
  /** Epoch ms when it last started running; null when paused. */
  runningSince: number | null;
  elapsedMs: number;
  addedMin: number;
}

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Match clock for timed sports (FR-SCR-11): start, pause, resume and added time. Kept on the scoring device so it
 * survives a reload or a dropped signal; periods themselves are still ended with the "End period" button.
 * shortcut: the clock isn't shared with viewers; send it with score updates if the public board should show it.
 */
export function MatchClock({ matchId, periodMinutes, period }: { matchId: string; periodMinutes: number; period: string }) {
  const key = `fp.clock.${matchId}`;
  const [c, setC] = useState<Clock>({ runningSince: null, elapsedMs: 0, addedMin: 0 });
  const [, tick] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem(key);
    if (saved) setC(JSON.parse(saved));
  }, [key]);
  useEffect(() => {
    if (!c.runningSince) return;
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [c.runningSince]);

  const save = (next: Clock) => {
    setC(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  const elapsed = c.elapsedMs + (c.runningSince ? Date.now() - c.runningSince : 0);
  const limit = (periodMinutes + c.addedMin) * 60_000;
  const over = elapsed >= limit;

  return (
    <section aria-label="Match clock" className="mt-6 rounded-xl border-2 border-ink bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold uppercase tracking-wider">{period}</span>
        <span className="text-sm font-semibold">
          {periodMinutes} min{c.addedMin ? ` + ${c.addedMin}` : ""}
        </span>
      </div>
      <p className={`mt-1 text-center font-score text-6xl font-bold tabular ${over ? "rounded bg-warn" : ""}`} aria-live="off">
        {mmss(elapsed)}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {c.runningSince ? (
          <button onClick={() => save({ ...c, runningSince: null, elapsedMs: elapsed })} className="h-14 rounded-xl bg-navy text-lg font-bold text-white">
            Pause
          </button>
        ) : (
          <button onClick={() => save({ ...c, runningSince: Date.now() })} className="h-14 rounded-xl bg-navy text-lg font-bold text-white">
            {elapsed ? "Resume" : "Start"}
          </button>
        )}
        <button onClick={() => save({ ...c, addedMin: c.addedMin + 1 })} className="h-14 rounded-xl border-2 border-ink text-lg font-bold">
          +1 min
        </button>
        <button
          onClick={() => (elapsed === 0 || confirm("Reset the clock for the next period?")) && save({ runningSince: null, elapsedMs: 0, addedMin: 0 })}
          className="h-14 rounded-xl border-2 border-ink text-lg font-bold"
        >
          Reset
        </button>
      </div>
    </section>
  );
}
