"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function Header() {
  const { user, loading } = useAuth();
  return (
    <header className="border-b border-line bg-cream/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="font-score text-2xl font-bold uppercase tracking-[0.08em] text-navy">
          Force<span className="text-ink">Pulse</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm font-semibold">
          <Link href="/" className="rounded-md px-3 py-2 hover:bg-line/60">
            Tournaments
          </Link>
          {user ? (
            <Link href="/organise" className="hidden rounded-md px-3 py-2 hover:bg-line/60 sm:inline">
              Organise
            </Link>
          ) : null}
          {user && user.platformRole !== "player" ? (
            <Link href="/admin" className="rounded-md px-3 py-2 hover:bg-line/60">
              Admin
            </Link>
          ) : null}
          {loading ? null : user ? (
            <Link href="/me" className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-line/60">
              <span className="hidden text-muted sm:inline">{user.roleLabel || "Account"}</span>
              <span className="sm:hidden">Account</span>
            </Link>
          ) : (
            <Link href="/login" className="rounded-md bg-navy px-4 py-2 text-white hover:bg-navy/90">
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
