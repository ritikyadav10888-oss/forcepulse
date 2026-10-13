"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { PUBLIC_API_URL } from "./api";

let socket: Socket | null = null;

/** One shared connection to the API's live updates (same host as the API, without /api/v1). */
export function connection(): Socket {
  socket ??= io(PUBLIC_API_URL.replace(/\/api\/v1\/?$/, ""), { transports: ["websocket"] });
  return socket;
}

/**
 * Keeps `initial` up to date with `event` messages from `room` (match:<id>, tournament:<id>, auction:<id>).
 * Each message carries the full state, so it simply replaces what we had.
 */
export function useLive<T>(room: string, event: string, initial: T): T {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const s = connection();
    const join = () => void s.emit("subscribe", room);
    const onEvent = (data: T) => setValue(data);
    join();
    s.on("connect", join); // rejoin after a dropped connection
    s.on(event, onEvent);
    return () => {
      s.off("connect", join);
      s.off(event, onEvent);
      s.emit("unsubscribe", room);
    };
  }, [room, event]);
  return value;
}
