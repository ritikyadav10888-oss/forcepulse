import Link from "next/link";

const COLUMNS: { title: string; links: [string, string][] }[] = [
  { title: "Play", links: [["/tournaments", "Tournaments"], ["/live", "Live scores"], ["/play/new", "Play a casual match"], ["/join", "Join a team"]] },
  { title: "Organise", links: [["/organise/new", "Create a tournament"], ["/organise", "My tournaments"], ["/pages/sports", "Sports and services"]] },
  { title: "Force Pulse", links: [["/pages/about", "About"], ["/pages/partners", "Partners"], ["/pages/faq", "FAQs"], ["/contact", "Contact"]] },
  { title: "Legal", links: [["/pages/terms", "Terms"], ["/pages/privacy", "Privacy"], ["/pages/refunds", "Payments and refunds"]] },
];

/** The same footer on every page (FR-ABT-01 pages are all one click away). */
export function SiteFooter() {
  return (
    <footer className="mt-16 bg-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <p className="font-score text-3xl font-bold uppercase tracking-[0.08em]">Force Pulse</p>
          <p className="mt-2 max-w-xs text-sm text-white/80">Tournaments, live scores and player auctions for grassroots sport in India.</p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">{c.title}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {c.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="hover:underline">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/15">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-white/70 sm:px-6">© {new Date().getFullYear()} Force Sports and Wears India. All rights reserved.</p>
      </div>
    </footer>
  );
}
