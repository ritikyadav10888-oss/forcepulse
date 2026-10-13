"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/tournaments", label: "Tournaments" },
  { href: "/live", label: "Live" },
  { href: "/play/new", label: "Play a match" },
  { href: "/pages/about", label: "About" },
];

/** One header on every page: logo, main menu, account. On phones the menu folds behind a button. */
export function Header() {
  const { user, loading } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const links = [...NAV, ...(user ? [{ href: "/organise", label: "Organise" }] : []), ...(user && user.platformRole !== "player" ? [{ href: "/admin", label: "Admin" }] : [])];
  const active = (href: string) => path === href || (href !== "/" && path.startsWith(href.split("/").slice(0, 2).join("/")));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="font-score text-2xl font-bold uppercase tracking-[0.08em] text-navy" aria-label="Force Pulse home">
          Force<span className="text-ink">Pulse</span>
        </Link>

        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 text-sm font-semibold lg:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined} className={`rounded-md px-3 py-2 hover:bg-line/60 ${active(l.href) ? "text-navy underline decoration-2 underline-offset-8" : ""}`}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 text-sm font-semibold">
          {loading ? null : user ? (
            <Link href="/me" className="hidden rounded-md px-3 py-2 hover:bg-line/60 sm:inline">
              <span className="text-muted">{user.roleLabel || "Account"}</span>
            </Link>
          ) : path === "/login" || path === "/staff/login" ? null : (
            <Link href="/login" className="rounded-md bg-navy px-4 py-2 text-white hover:bg-navy/90">
              Log in
            </Link>
          )}
          {user ? (
            <Link href="/me" className="rounded-md bg-navy px-4 py-2 text-white hover:bg-navy/90 sm:hidden">
              Account
            </Link>
          ) : null}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen(!open)}
            className="grid size-11 place-items-center rounded-md border border-line lg:hidden"
          >
            <span aria-hidden className="text-xl leading-none">{open ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>

      {open ? (
        <nav id="mobile-menu" aria-label="Main" className="border-t border-line bg-cream px-4 pb-4 lg:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`block border-b border-line py-3 text-base font-semibold ${active(l.href) ? "text-navy" : ""}`}>
              {l.label}
            </Link>
          ))}
          {user ? (
            <Link href="/me" className="block py-3 text-base font-semibold">
              My account <span className="text-sm font-normal text-muted">· {user.roleLabel}</span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </header>
  );
}
