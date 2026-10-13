"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Empty } from "@/components/bits";
import { PayButton } from "@/components/pay";
import { ApiError, type Tournament } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateRange, statusLabel } from "@/lib/format";

interface Player {
  id: string;
  playerCode: string;
  name: string;
  gender: "male" | "female" | null;
  dob: string | null;
  city: string;
  state: string;
}
interface Entry {
  id: string;
  registrationNo: string;
  tournamentId: string;
  status: string;
  paymentStatus: string;
  feePaise: number;
}

const ENTRY: Record<string, string> = {
  payment_pending: "Payment due",
  pending_review: "Waiting for the organiser",
  enrolled: "Registered",
  waitlisted: "Waitlisted",
  rejected: "Not accepted",
  removed: "Removed",
  expired: "Payment time ran out",
};

export default function AccountPage() {
  const { user, loading, call, signOut } = useAuth();
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mine, setMine] = useState<Tournament[]>([]);
  const [casual, setCasual] = useState<{ matchId: string; name: string; status: string; homeScore: number | null; awayScore: number | null }[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) return router.replace("/login?next=/me");
    void Promise.all([call<Player>("/me/player").catch(() => null), call<Entry[]>("/me/enrollments"), call<Tournament[]>("/me/tournaments")]).then(([p, e, t]) => {
      setPlayer(p);
      setEntries(e);
      setMine(t);
      void call<typeof casual>("/me/casual-matches").then(setCasual);
    });
  }, [user, loading, call, router]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "").trim();
    setError(null);
    setSaved(null);
    try {
      const p = await call<Player>("/me/player", {
        method: "PATCH",
        body: { name: get("name"), city: get("city"), state: get("state"), gender: get("gender") || null, dob: get("dob") || null },
      });
      setPlayer(p);
      setSaved("Profile saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    }
  }

  if (loading || !user) return <p className="pt-14 text-muted">Loading your account…</p>;

  const field = "mt-1 h-11 w-full rounded-lg border border-line bg-white px-3";
  return (
    <div className="grid gap-12 pt-10 md:grid-cols-[1fr_18rem]">
      <section>
        <p className="text-sm font-semibold text-muted">{user.roleLabel}</p>
        <h1 className="font-score text-4xl font-bold uppercase tracking-wide">{player?.name || "Your account"}</h1>
        {player ? <p className="mt-1 text-sm text-muted">Player ID <span className="font-bold tabular text-ink">{player.playerCode}</span> · {user.phone} ·{" "}
            <Link href={`/p/${player.id}`} className="font-semibold text-navy underline">
              View my profile
            </Link>
          </p> : null}

        <h2 className="mt-10 text-xs font-bold uppercase tracking-wider text-muted">My registrations</h2>
        {entries.length ? (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="tabular font-semibold">{e.registrationNo}</span>
                {e.status === "payment_pending" ? (
                  <PayButton amountPaise={e.feePaise} create={() => call("/payments/orders", { method: "POST", body: { enrollmentIds: [e.id] } })} onPaid={() => location.reload()} />
                ) : (
                  <span className={e.status === "enrolled" ? "font-semibold" : "text-muted"}>{ENTRY[e.status] ?? e.status}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2">
            <Empty title="You haven't registered for a tournament yet.">
              <Link href="/" className="font-semibold text-navy underline">
                Find a tournament
              </Link>
            </Empty>
          </div>
        )}

        <div className="mt-10 flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Casual matches</h2>
          <Link href="/play/new" className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">
            New casual match
          </Link>
        </div>
        {casual.length ? (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {casual.map((c) => (
              <li key={c.matchId}>
                <Link href={c.status === "completed" ? `/m/${c.matchId}` : `/score/${c.matchId}`} className="flex items-center justify-between gap-3 py-3 text-sm hover:bg-line/40">
                  <span className="font-semibold">{c.name}</span>
                  <span className="tabular text-muted">{c.status === "completed" ? `${c.homeScore}–${c.awayScore}` : c.status === "live" ? "Scoring" : "Not started"}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Score a quick game with friends: pick a sport, add players by mobile.</p>
        )}

        {mine.length ? (
          <>
            <h2 className="mt-10 text-xs font-bold uppercase tracking-wider text-muted">Tournaments I organise</h2>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {mine.map((t) => (
                <li key={t.id}>
                  <Link href={`/t/${t.slug}`} className="flex items-center justify-between gap-3 py-3 text-sm hover:bg-line/40">
                    <span className="font-semibold">{t.name}</span>
                    <span className="text-muted">
                      {dateRange(t.startsAt, t.endsAt)} · {statusLabel(t.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <aside>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Profile</h2>
        {player ? (
          <form onSubmit={save} className="mt-3 space-y-4 text-sm">
            <label className="block font-semibold">
              Name
              <input name="name" required defaultValue={player.name} className={field} />
            </label>
            <label className="block font-semibold">
              Date of birth
              <input name="dob" type="date" defaultValue={player.dob ?? ""} className={field} />
            </label>
            <label className="block font-semibold">
              Gender
              <select name="gender" defaultValue={player.gender ?? ""} className={field}>
                <option value="">Not set</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <label className="block font-semibold">
              City
              <input name="city" defaultValue={player.city} className={field} />
            </label>
            <label className="block font-semibold">
              State
              <input name="state" defaultValue={player.state} className={field} />
            </label>
            {error ? <p role="alert" className="font-semibold text-bad">{error}</p> : null}
            {saved ? <p role="status" className="font-semibold text-good">{saved}</p> : null}
            <button className="h-11 w-full rounded-lg bg-navy font-semibold text-white hover:bg-navy/90">Save profile</button>
            <p className="text-xs text-muted">Your date of birth and pincode are never shown on your public profile.</p>
          </form>
        ) : null}
        <h2 className="mt-10 text-xs font-bold uppercase tracking-wider text-muted">Your data</h2>
        <div className="mt-2 space-y-2 text-sm">
          <button
            className="block font-semibold text-navy underline"
            onClick={() =>
              void call("/me/data").then((d) => {
                const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" })), download: "force-pulse-my-data.json" });
                a.click();
              })
            }
          >
            Download my data
          </button>
          <button
            className="block font-semibold text-bad underline"
            onClick={() => {
              if (!confirm("Ask Force Pulse to delete your account? Your profile will be removed and you will be signed out. Payment records are kept as the law requires.")) return;
              const reason = prompt("Anything you'd like to tell us? (optional)") ?? "";
              void call("/me/deletion-request", { method: "POST", body: { reason } }).then(() => setSaved("Deletion requested. We'll process it shortly."));
            }}
          >
            Delete my account
          </button>
        </div>
        <button onClick={() => void signOut().then(() => router.push("/"))} className="mt-8 text-sm font-semibold text-navy underline">
          Log out
        </button>
      </aside>
    </div>
  );
}
