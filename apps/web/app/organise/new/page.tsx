"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { btn, btnGhost, Field, h2, input, Message, useAction } from "@/components/form";
import { apiFetch, PUBLIC_API_URL, type Sport, type Tournament } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Cat {
  name: string;
  gender: "any" | "male" | "female";
  underAge: string;
  minAge: string;
  fee: string;
}
interface Ev {
  sportId: string;
  entryType: "individual" | "team" | "pooled";
  fee: string;
  maxTeams: string;
  minPlayers: string;
  maxPlayers: string;
  categories: Cat[];
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const paise = (v: string) => Math.round(Number(v || 0) * 100);
/** "2026-11-20T09:00" typed in India time → ISO with offset. */
const ist = (local: string) => (local ? `${local}:00+05:30` : null);

/** Create a tournament (FR-TRN-01). Creating one makes the player an Organiser (FR-AUTH-03). */
export default function NewTournament() {
  const { user, loading, call } = useAuth();
  const router = useRouter();
  const [sports, setSports] = useState<Sport[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/organise/new");
    void apiFetch<Sport[]>("/sports", { base: PUBLIC_API_URL }).then(setSports);
  }, [loading, user, router]);

  const setEv = (i: number, patch: Partial<Ev>) => setEvents(events.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const setCat = (i: number, k: number, patch: Partial<Cat>) => setEv(i, { categories: events[i].categories.map((c, j) => (j === k ? { ...c, ...patch } : c)) });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "").trim();
    const t = await run(() =>
      call<Tournament>("/tournaments", {
        method: "POST",
        body: {
          name: get("name"),
          description: get("description"),
          venue: get("venue"),
          city: get("city"),
          startsAt: ist(get("startsAt")),
          endsAt: ist(get("endsAt")),
          registrationDeadline: ist(get("deadline")),
          visibility: get("visibility"),
          inviteMode: get("visibility") === "private" ? "link" : null,
          reviewRequired: f.get("review") === "on",
          refundPolicy: get("refundPolicy"),
          contactName: get("contactName"),
          contactPhone: get("contactPhone"),
          status: "draft",
          events: events.map((ev) => ({
            sportId: ev.sportId,
            entryType: ev.entryType,
            poolFormation: ev.entryType === "pooled" ? "auction" : null,
            feePaise: paise(ev.fee),
            maxTeams: num(ev.maxTeams),
            minPlayersPerTeam: ev.entryType === "individual" ? null : num(ev.minPlayers),
            maxPlayersPerTeam: ev.entryType === "individual" ? null : num(ev.maxPlayers),
            categories: ev.categories.map((c) => ({ name: c.name, gender: c.gender, underAge: num(c.underAge), minAge: num(c.minAge), feePaise: c.fee ? paise(c.fee) : null })),
          })),
        },
      }),
    );
    if (t) router.push(`/organise/${t.id}`);
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-8 pt-10">
      <h1 className="font-score text-4xl font-bold uppercase tracking-wide">New tournament</h1>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name">
            <input name="name" required className={input} />
          </Field>
        </div>
        <Field label="Starts (India time)">
          <input name="startsAt" type="datetime-local" required className={input} />
        </Field>
        <Field label="Ends">
          <input name="endsAt" type="datetime-local" required className={input} />
        </Field>
        <Field label="Registration closes" hint="Optional. You can also close it by hand.">
          <input name="deadline" type="datetime-local" className={input} />
        </Field>
        <Field label="Who can see it">
          <select name="visibility" className={input}>
            <option value="public">Listed publicly</option>
            <option value="private">Private: link only</option>
          </select>
        </Field>
        <Field label="Venue">
          <input name="venue" className={input} />
        </Field>
        <Field label="City">
          <input name="city" className={input} />
        </Field>
        <Field label="Contact name">
          <input name="contactName" className={input} />
        </Field>
        <Field label="Contact phone">
          <input name="contactPhone" type="tel" className={input} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="About the tournament">
            <textarea name="description" rows={3} className={`${input} h-auto py-2`} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Refund policy" hint="Shown to players before they pay. After registration, refunds are handled by you.">
            <textarea name="refundPolicy" rows={2} className={`${input} h-auto py-2`} />
          </Field>
        </div>
        <label className="flex items-center gap-3 text-sm font-semibold sm:col-span-2">
          <input type="checkbox" name="review" className="size-5" />
          Review entries before accepting them (approve, reject, waitlist)
        </label>
      </section>

      <section>
        <h2 className={h2}>Sports</h2>
        <div className="mt-2 space-y-4">
          {events.map((ev, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-line bg-white p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Sport">
                  <select value={ev.sportId} onChange={(e) => setEv(i, { sportId: e.target.value })} className={input}>
                    {sports.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Entries">
                  <select value={ev.entryType} onChange={(e) => setEv(i, { entryType: e.target.value as Ev["entryType"] })} className={input}>
                    <option value="individual">Individual players</option>
                    <option value="team">Teams register together</option>
                    <option value="pooled">Players alone, teams by auction</option>
                  </select>
                </Field>
                <Field label="Fee (₹)" hint={ev.entryType === "team" ? "Per team, paid by the captain" : "Per player"}>
                  <input type="number" min={0} value={ev.fee} onChange={(e) => setEv(i, { fee: e.target.value })} className={input} />
                </Field>
                <Field label={ev.entryType === "individual" ? "Max entries" : "Max teams"}>
                  <input type="number" min={2} value={ev.maxTeams} onChange={(e) => setEv(i, { maxTeams: e.target.value })} placeholder="No limit" className={input} />
                </Field>
                {ev.entryType !== "individual" ? (
                  <>
                    <Field label="Min players / team">
                      <input type="number" min={1} value={ev.minPlayers} onChange={(e) => setEv(i, { minPlayers: e.target.value })} className={input} />
                    </Field>
                    <Field label="Max players / team">
                      <input type="number" min={1} value={ev.maxPlayers} onChange={(e) => setEv(i, { maxPlayers: e.target.value })} className={input} />
                    </Field>
                  </>
                ) : null}
              </div>

              {ev.categories.map((c, k) => (
                <div key={k} className="grid gap-2 rounded-md bg-cream p-3 sm:grid-cols-5">
                  <Field label="Category">
                    <input value={c.name} required onChange={(e) => setCat(i, k, { name: e.target.value })} placeholder="U-14 Boys" className={input} />
                  </Field>
                  <Field label="Gender">
                    <select value={c.gender} onChange={(e) => setCat(i, k, { gender: e.target.value as Cat["gender"] })} className={input}>
                      <option value="any">Any</option>
                      <option value="male">Boys / men</option>
                      <option value="female">Girls / women</option>
                    </select>
                  </Field>
                  <Field label="Under age">
                    <input type="number" value={c.underAge} onChange={(e) => setCat(i, k, { underAge: e.target.value })} className={input} />
                  </Field>
                  <Field label="Min age">
                    <input type="number" value={c.minAge} onChange={(e) => setCat(i, k, { minAge: e.target.value })} className={input} />
                  </Field>
                  <Field label="Fee (₹)">
                    <input type="number" min={0} value={c.fee} onChange={(e) => setCat(i, k, { fee: e.target.value })} placeholder="Same" className={input} />
                  </Field>
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button" className={btnGhost} onClick={() => setEv(i, { categories: [...ev.categories, { name: "", gender: "any", underAge: "", minAge: "", fee: "" }] })}>
                  Add category
                </button>
                <button type="button" className="text-sm font-semibold text-bad underline" onClick={() => setEvents(events.filter((_, j) => j !== i))}>
                  Remove sport
                </button>
              </div>
            </div>
          ))}
          <button type="button" className={btnGhost} onClick={() => setEvents([...events, { sportId: sports[0]?.id ?? "badminton", entryType: "individual", fee: "", maxTeams: "", minPlayers: "", maxPlayers: "", categories: [] }])}>
            Add a sport
          </button>
        </div>
      </section>

      <Message error={error} />
      <button disabled={busy || !events.length} className={`${btn} w-full`}>
        {busy ? "Creating…" : "Create tournament (as draft)"}
      </button>
    </form>
  );
}
