"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { btn, btnDanger, Field, h2, input, Message, useAction } from "./form";

interface ContactMsg {
  id: string;
  name: string;
  contact: string;
  message: string;
  createdAt: string;
}
interface PrivacyReq {
  id: string;
  name: string | null;
  phone: string | null;
  reason: string;
  createdAt: string;
}

/** Site pages (FR-ABT-02), contact messages, and deletion requests (NFR-10) for staff. */
export function AdminSite({ superAdmin }: { superAdmin: boolean }) {
  const { call } = useAuth();
  const [pages, setPages] = useState<{ slug: string; title: string }[]>([]);
  const [slug, setSlug] = useState("about");
  const [page, setPage] = useState({ title: "", body: "" });
  const [msgs, setMsgs] = useState<ContactMsg[]>([]);
  const [reqs, setReqs] = useState<PrivacyReq[]>([]);
  const { busy, error, ok, run } = useAction();

  const load = useCallback(() => {
    void call<ContactMsg[]>("/admin/contact-messages").then(setMsgs);
    if (superAdmin) void call<PrivacyReq[]>("/admin/privacy-requests").then(setReqs);
  }, [call, superAdmin]);
  useEffect(() => {
    load();
    void call<typeof pages>("/pages").then(setPages);
  }, [load, call]);
  useEffect(() => {
    void call<{ title: string; body: string }>(`/pages/${slug}`).then((p) => setPage({ title: p.title, body: p.body }));
  }, [call, slug]);

  return (
    <div className="space-y-12">
      {msgs.length ? (
        <section>
          <h2 className={h2}>Contact messages</h2>
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {msgs.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-4 py-3">
                <span>
                  <b>{m.name}</b> · {m.contact}
                  <span className="mt-1 block whitespace-pre-line">{m.message}</span>
                </span>
                <button className="shrink-0 font-semibold text-navy underline" onClick={() => void run(() => call(`/admin/contact-messages/${m.id}/handled`, { method: "POST", body: {} })).then(load)}>
                  Done
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {superAdmin && reqs.length ? (
        <section>
          <h2 className={h2}>Account deletion requests</h2>
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {reqs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <b>{r.name || "Unnamed player"}</b> · {r.phone}
                  {r.reason ? <span className="block text-muted">“{r.reason}”</span> : null}
                </span>
                <button
                  className={btnDanger}
                  disabled={busy}
                  onClick={() => confirm("Delete this person's details? This can't be undone.") && void run(() => call(`/admin/privacy-requests/${r.id}/complete`, { method: "POST", body: {} }), "Account deleted.").then(load)}
                >
                  Delete details
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {superAdmin ? (
        <section className="space-y-3">
          <h2 className={h2}>Site pages</h2>
          <select aria-label="Page" value={slug} onChange={(e) => setSlug(e.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm">
            {pages.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
              </option>
            ))}
          </select>
          <Field label="Title">
            <input value={page.title} onChange={(e) => setPage({ ...page, title: e.target.value })} className={input} />
          </Field>
          <Field label="Text" hint='"## " starts a heading, "- " a bullet, a blank line a new paragraph, **bold**.'>
            <textarea value={page.body} onChange={(e) => setPage({ ...page, body: e.target.value })} rows={14} className={`${input} h-auto py-2 font-mono text-xs`} />
          </Field>
          <div className="flex items-center gap-4">
            <button className={btn} disabled={busy} onClick={() => void run(() => call(`/admin/pages/${slug}`, { method: "PUT", body: page }), "Page saved.")}>
              Save page
            </button>
            <a href={`/pages/${slug}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-navy underline">
              View page
            </a>
          </div>
        </section>
      ) : null}
      <Message error={error} ok={ok} />
    </div>
  );
}
