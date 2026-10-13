"use client";

import { useState } from "react";
import type { FieldDef } from "@force-pulse/shared";
import { PUBLIC_API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { input } from "./form";

type Answers = Record<string, unknown>;

/** Renders an organiser's registration form (FR-REG-03). Nothing is pre-filled (FR-REG-02). */
export function FormFields({ fields, answers, set }: { fields: FieldDef[]; answers: Answers; set: (key: string, value: unknown) => void }) {
  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <FieldInput key={f.key} f={f} value={answers[f.key]} set={(v) => set(f.key, v)} />
      ))}
    </div>
  );
}

function FieldInput({ f, value, set }: { f: FieldDef; value: unknown; set: (v: unknown) => void }) {
  const label = (
    <span>
      {f.label}
      {f.required ? <span aria-hidden> *</span> : <span className="font-normal text-muted"> (optional)</span>}
    </span>
  );
  const help = f.helpText ? <span className="mt-1 block text-xs font-normal text-muted">{f.helpText}</span> : null;
  const str = typeof value === "string" ? value : "";

  if (f.type === "radio" || f.type === "yesno") {
    const opts = f.type === "yesno" ? ["Yes", "No"] : (f.options ?? []);
    return (
      <fieldset className="text-sm font-semibold">
        <legend>{label}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {opts.map((o) => {
            const v = f.type === "yesno" ? o === "Yes" : o;
            return (
              <label key={o} className={`flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 font-normal ${value === v ? "border-navy bg-white" : "border-line bg-white/60"}`}>
                <input type="radio" name={f.key} checked={value === v} onChange={() => set(v)} required={f.required} />
                {o}
              </label>
            );
          })}
        </div>
        {help}
      </fieldset>
    );
  }
  if (f.type === "checkbox") {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="text-sm font-semibold">
        <legend>{label}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {(f.options ?? []).map((o) => (
            <label key={o} className="flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 font-normal">
              <input type="checkbox" checked={list.includes(o)} onChange={(e) => set(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
              {o}
            </label>
          ))}
        </div>
        {help}
      </fieldset>
    );
  }
  if (f.type === "consent") {
    return (
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 size-5" checked={value === true} onChange={(e) => set(e.target.checked)} required={f.required} />
        <span>
          {label}
          {help}
        </span>
      </label>
    );
  }
  if (f.type === "photo" || f.type === "file") return <Upload f={f} label={label} help={help} value={str} set={set} />;

  const common = { value: str, required: f.required, onChange: (e: { target: { value: string } }) => set(e.target.value), className: input };
  return (
    <label className="block text-sm font-semibold">
      {label}
      {f.type === "textarea" ? (
        <textarea {...common} rows={3} className={`${input} h-auto py-2`} />
      ) : f.type === "select" ? (
        <select {...common}>
          <option value="">Choose…</option>
          {(f.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : f.type === "pincode" ? (
        <Pincode {...common} />
      ) : (
        <input {...common} type={f.type === "phone" ? "tel" : f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "date" ? "date" : "text"} />
      )}
      {help}
    </label>
  );
}

/** FR-REG-05: 6 digits; city and state come from the India Post table. */
function Pincode(props: { value: string; onChange: (e: { target: { value: string } }) => void; required: boolean; className: string }) {
  const [place, setPlace] = useState<string | null>(null);
  async function look(v: string) {
    props.onChange({ target: { value: v } });
    setPlace(null);
    if (!/^[1-9]\d{5}$/.test(v)) return;
    const r = await fetch(`${PUBLIC_API_URL}/pincodes/${v}`);
    const d = await r.json();
    setPlace(r.ok ? `${d.city}, ${d.state}` : "Pincode not found: enter your city separately.");
  }
  return (
    <>
      <input inputMode="numeric" maxLength={6} value={props.value} required={props.required} onChange={(e) => void look(e.target.value.replace(/\D/g, ""))} className={props.className} />
      {place ? <span className="mt-1 block text-xs font-normal text-muted">{place}</span> : null}
    </>
  );
}

function Upload({ f, label, help, value, set }: { f: FieldDef; label: React.ReactNode; help: React.ReactNode; value: string; set: (v: unknown) => void }) {
  const { token } = useAuth();
  const [state, setState] = useState<string | null>(null);
  async function pick(file: File | undefined) {
    if (!file) return;
    setState("Uploading…");
    const body = new FormData();
    body.append("kind", f.type === "photo" ? "photo" : "file");
    body.append("file", file);
    const r = await fetch(`${PUBLIC_API_URL}/uploads`, { method: "POST", body, headers: { Authorization: `Bearer ${token()}` } });
    const d = await r.json();
    if (!r.ok) return setState(d.message ?? "Upload failed.");
    set(d.key);
    setState("Uploaded.");
  }
  return (
    <label className="block text-sm font-semibold">
      {label}
      <input type="file" accept={f.type === "photo" ? "image/jpeg,image/png,image/webp" : "image/*,application/pdf"} onChange={(e) => void pick(e.target.files?.[0])} className="mt-1 block w-full text-sm" />
      {state || value ? <span className="mt-1 block text-xs font-normal text-muted">{state ?? "Uploaded."}</span> : null}
      {help}
    </label>
  );
}
