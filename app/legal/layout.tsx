import Link from 'next/link';
import type { ReactNode } from 'react';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-white/[0.06] bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5 lg:px-10">
          <Link href="/" className="text-lg font-semibold tracking-tight text-white hover:text-emerald-400 transition">
            SLIPPR
          </Link>
          <nav className="flex items-center gap-5 text-sm text-zinc-400">
            <Link href="/legal" className="hover:text-white transition">
              Legal
            </Link>
            <Link href="/" className="hover:text-white transition">
              App
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12 lg:px-10 lg:py-16">{children}</main>
      <footer className="border-t border-white/[0.06] px-6 py-8 text-center text-xs text-zinc-600 lg:px-10">
        <p className="mb-3">
          SLIPPR is a sports analytics platform. We do not accept wagers or operate as a sportsbook.
        </p>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          <Link href="/legal/terms" className="hover:text-zinc-400 transition">
            Terms
          </Link>
          <Link href="/legal/responsible-play" className="hover:text-zinc-400 transition">
            Responsible Play
          </Link>
          <a href="tel:1-800-426-2537" className="hover:text-zinc-400 transition">
            1-800-GAMBLER
          </a>
        </div>
      </footer>
    </div>
  );
}
