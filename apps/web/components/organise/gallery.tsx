"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, PUBLIC_API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { h2, Message, useAction } from "../form";
import type { TabProps } from "./overview";

export interface MediaItem {
  id: string;
  type: "photo" | "video";
  caption: string;
  url: string;
  thumbUrl: string | null;
}
export const mediaUrl = (path: string) => PUBLIC_API_URL.replace(/\/api\/v1\/?$/, "") + path;

/** Gallery (FR-MED-01 to 04): up to 50 photos and videos, added by the organiser. */
export function GalleryTab({ t }: TabProps) {
  const { call, token } = useAuth();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [limit, setLimit] = useState(50);
  const { busy, error, ok, run } = useAction();
  const load = useCallback(() => void call<{ limit: number; items: MediaItem[] }>(`/tournaments/${t.id}/media`).then((r) => (setItems(r.items), setLimit(r.limit))), [call, t.id]);
  useEffect(load, [load]);

  async function add(file: File | undefined) {
    if (!file) return;
    await run(async () => {
      const body = new FormData();
      body.append("kind", "media");
      body.append("file", file);
      const r = await fetch(`${PUBLIC_API_URL}/uploads`, { method: "POST", body, headers: { Authorization: `Bearer ${token()}` } });
      const up = await r.json();
      if (!r.ok) throw new ApiError(r.status, up.code, up.message);
      await call(`/tournaments/${t.id}/media`, { method: "POST", body: { uploadKey: up.key, caption: "" } });
    });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={h2}>
          Gallery · {items.length} of {limit}
        </h2>
        <label className={`inline-flex h-11 cursor-pointer items-center rounded-lg bg-navy px-5 text-sm font-semibold text-white ${busy || items.length >= limit ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? "Uploading…" : "Add photo or video"}
          <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="sr-only" onChange={(e) => void add(e.target.files?.[0])} />
        </label>
      </div>
      <p className="text-xs text-muted">Photos up to 5 MB, videos (MP4/MOV) up to 20 MB.</p>
      <p className="text-xs text-muted">To show awards, upload the photo and caption it, for example &quot;Best Player: Rohan Nair&quot;.</p>
      <Message error={error} ok={ok} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((m) => (
          <li key={m.id} className="overflow-hidden rounded-lg border border-line bg-white">
            {m.type === "video" ? (
              <video src={mediaUrl(m.url)} poster={m.thumbUrl ? mediaUrl(m.thumbUrl) : undefined} controls preload="none" className="aspect-square w-full object-cover" />
            ) : (
              <a href={mediaUrl(m.url)} target="_blank" rel="noreferrer">
                <img src={mediaUrl(m.thumbUrl ?? m.url)} alt={m.caption || "Tournament photo"} loading="lazy" className="aspect-square w-full object-cover" />
              </a>
            )}
            <input
              aria-label="Caption"
              defaultValue={m.caption}
              placeholder="Caption, e.g. Best Player: Rohan Nair"
              maxLength={300}
              onBlur={(e) => e.target.value !== m.caption && void run(() => call(`/media/${m.id}`, { method: "PATCH", body: { caption: e.target.value } }), "Caption saved.").then(load)}
              className="w-full border-t border-line px-2 py-2 text-xs"
            />
            <button onClick={() => void run(() => call(`/media/${m.id}`, { method: "DELETE" })).then(load)} className="w-full py-2 text-xs font-semibold text-bad">
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
