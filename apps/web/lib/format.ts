// Display helpers. Dates and times are shown in India time, as tournaments are scheduled there.
const IST = "Asia/Kolkata";

export const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" });
export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: IST });

export function dateRange(start: string, end: string) {
  const a = dayLabel(start);
  const b = dayLabel(end);
  return a === b ? a : `${a} – ${b}`;
}

export function rupees(paise: number) {
  const r = paise / 100;
  return `₹${r.toLocaleString("en-IN", { maximumFractionDigits: Number.isInteger(r) ? 0 : 2, minimumFractionDigits: Number.isInteger(r) ? 0 : 2 })}`;
}

const STATUS: Record<string, string> = {
  draft: "Draft",
  enrollment_open: "Registration open",
  enrollment_closed: "Registration closed",
  team_formation: "Forming teams",
  fixtures_published: "Fixtures out",
  live: "Live",
  completed: "Completed",
};
export const statusLabel = (s: string) => STATUS[s] ?? s;

export const sportName = (id: string) => id.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
