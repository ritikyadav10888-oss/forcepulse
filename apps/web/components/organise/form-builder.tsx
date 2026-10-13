"use client";

import { useEffect, useState } from "react";
import { FIELD_TYPES, type FieldDef } from "@force-pulse/shared";
import { apiFetch, PUBLIC_API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { btn, btnGhost, h2, input, Message, useAction } from "../form";
import type { TabProps } from "./overview";

const TYPE_LABEL: Record<string, string> = {
  text: "Short text", textarea: "Paragraph", email: "Email", phone: "Phone", number: "Number", date: "Date", select: "Dropdown",
  radio: "One choice", checkbox: "Several choices", yesno: "Yes / no", consent: "Agree box", photo: "Photo", file: "File", pincode: "Pincode",
};
const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40) || "field";

/** Form builder (FR-REG-03/04): the organiser decides every field; publishing freezes a version. */
export function FormTab({ t }: TabProps) {
  const { call } = useAuth();
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [published, setPublished] = useState(0);
  const { busy, error, ok, run } = useAction();

  useEffect(() => {
    void call<{ draft: FieldDef[]; publishedVersion: number }>(`/tournaments/${t.id}/form`).then((f) => (setFields(f.draft), setPublished(f.publishedVersion)));
  }, [call, t.id]);

  const set = (i: number, patch: Partial<FieldDef>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...fields];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setFields(next);
  };
  const save = () => run(() => call(`/tournaments/${t.id}/form`, { method: "PUT", body: { fields } }), "Draft saved.");
  const publish = async () => {
    if (!(await save())) return;
    const r = await run(() => call<{ publishedVersion: number }>(`/tournaments/${t.id}/form/publish`, { method: "POST" }), "Published. New registrations use this version.");
    if (r) setPublished(r.publishedVersion);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={h2}>Registration form · {published ? `version ${published} live` : "not published yet"}</h2>
        {!fields.length ? (
          <button className={btnGhost} onClick={() => void apiFetch<FieldDef[]>("/forms/suggested-fields", { base: PUBLIC_API_URL }).then(setFields)}>
            Start from the suggested fields
          </button>
        ) : null}
      </div>

      {fields.map((f, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-line bg-white p-3 sm:grid-cols-[1fr_10rem_auto]">
          <input aria-label="Question" value={f.label} onChange={(e) => set(i, { label: e.target.value, key: f.key || keyOf(e.target.value) })} className={input} />
          <select aria-label="Type" value={f.type} onChange={(e) => set(i, { type: e.target.value as FieldDef["type"] })} className={input}>
            {FIELD_TYPES.map((x) => (
              <option key={x} value={x}>
                {TYPE_LABEL[x]}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} /> Required
            </label>
            <button aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="h-9 w-9 rounded border border-line disabled:opacity-30">↑</button>
            <button aria-label="Move down" disabled={i === fields.length - 1} onClick={() => move(i, 1)} className="h-9 w-9 rounded border border-line disabled:opacity-30">↓</button>
            <button aria-label="Remove" onClick={() => setFields(fields.filter((_, j) => j !== i))} className="h-9 w-9 rounded border border-line">✕</button>
          </div>
          {f.type === "select" || f.type === "radio" || f.type === "checkbox" ? (
            <input
              aria-label="Options"
              placeholder="Options, separated by commas"
              value={(f.options ?? []).join(", ")}
              onChange={(e) => set(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
              className={`${input} sm:col-span-3`}
            />
          ) : null}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button className={btnGhost} onClick={() => setFields([...fields, { key: `field_${fields.length + 1}`, label: "", type: "text", required: false }])}>
          Add a question
        </button>
        <button className={btnGhost} disabled={busy} onClick={() => void save()}>
          Save draft
        </button>
        <button className={btn} disabled={busy || !fields.length} onClick={() => void publish()}>
          Publish form
        </button>
      </div>
      <Message error={error} ok={ok} />
    </div>
  );
}
