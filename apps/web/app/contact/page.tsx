"use client";

import { useState, type FormEvent } from "react";
import { btn, Field, input, Message, useAction } from "@/components/form";
import { apiFetch, PUBLIC_API_URL } from "@/lib/api";

/** Contact form (FR-ABT-01). Messages reach Force Pulse staff in Admin. */
export default function Contact() {
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run(() => apiFetch("/contact", { method: "POST", base: PUBLIC_API_URL, body: { name: f.get("name"), contact: f.get("contact"), message: f.get("message") } }));
    if (r) setSent(true);
  }

  return (
    <section className="max-w-xl pt-10">
      <h1 className="font-score text-4xl font-bold uppercase tracking-wide">Contact us</h1>
      {sent ? (
        <p className="mt-6 rounded-lg bg-white p-4">Thanks: we've got your message and will reply soon.</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Your name">
            <input name="name" required className={input} />
          </Field>
          <Field label="Mobile or email" hint="So we can reply.">
            <input name="contact" required minLength={5} className={input} />
          </Field>
          <Field label="Message">
            <textarea name="message" required minLength={5} rows={5} className={`${input} h-auto py-2`} />
          </Field>
          <Message error={error} />
          <button disabled={busy} className={btn}>
            {busy ? "Sending…" : "Send"}
          </button>
        </form>
      )}
    </section>
  );
}
