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
}
export const mediaUrl = (path: string) => PUBLIC_API_URL.replace(/\/api\/v1\/?$/, "") + path;

/** Gallery (FR-MED-01 to 04): up to 50 photos and videos, added by the organiser. */
export function GalleryTab({ t }: TabProps) {
  const { call, token } = useAuth();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [limit, setLimit] = useState(50);
  const { busy, error, run } = useAction();
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
      <Message error={error} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((m) => (
          <li key={m.id} className="overflow-hidden rounded-lg border border-line bg-white">
            {m.type === "video" ? <video src={mediaUrl(m.url)} controls preload="metadata" className="aspect-square w-full object-cover" /> : <img src={mediaUrl(m.url)} alt={m.caption || "Tournament photo"} className="aspect-square w-full object-cover" />}
            <button onClick={() => void run(() => call(`/media/${m.id}`, { method: "DELETE" })).then(load)} className="w-full py-2 text-xs font-semibold text-bad">
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
