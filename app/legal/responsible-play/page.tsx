import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Responsible Play',
  description:
    'SLIPPR responsible play resources — age requirements, problem gambling help, and research-first usage.',
};

const RESOURCES = [
  {
    name: 'National Problem Gambling Helpline',
    phone: '1-800-522-4700',
    tel: 'tel:1-800-522-4700',
    note: '24/7 confidential support (US).',
  },
  {
    name: 'National Council on Problem Gambling',
    phone: '1-800-GAMBLER',
    tel: 'tel:1-800-426-2537',
    note: 'Text or call for help and local referrals.',
  },
  {
    name: 'Gamblers Anonymous',
    phone: 'ga.org',
    tel: 'https://www.gamblersanonymous.org',
    note: 'Free peer support meetings worldwide.',
  },
];

export default function ResponsiblePlayPage() {
  return (
    <article className="legal-prose">
      <p className="eyebrow mb-3">Legal</p>
      <h1>Responsible Play</h1>
      <p className="legal-muted">Research tools, not a path to wealth</p>

      <h2>Our Position</h2>
      <p>
        SLIPPR is an <strong>analytics platform</strong>. We grade lines, surface model consensus,
        flag predatory pricing, and publish fade alerts as informational research. We deliberately
        do not accept wagers, hold funds, or profit from betting volume — that separation lets us
        focus on analysis without the conflicts of a sportsbook.
      </p>
      <p>
        Sports outcomes are uncertain. Even strong model edges lose regularly. Profitable wagering
        — where legal — requires discipline, bankroll management, and a long-term view. SLIPPR is
        designed to support better decisions, not to promise wins.
      </p>

      <h2>Age Requirements</h2>
      <p>
        You must meet the minimum legal age in your jurisdiction to use a sportsbook (typically{' '}
        <strong>21+</strong> in most US states with legal betting, or <strong>18+</strong> in some
        jurisdictions). SLIPPR does not verify age for analytics access, but you must be of legal
        age wherever you choose to wager.
      </p>

      <h2>Know Your Jurisdiction</h2>
      <p>
        Sports betting laws vary by state and country. SLIPPR analytics may be available broadly
        because we provide research — not wagering. <strong>You</strong> are responsible for
        confirming that any action you take at a sportsbook or prediction market is lawful where
        you live.
      </p>

      <h2>Using SLIPPR Responsibly</h2>
      <ul>
        <li>
          <strong>Treat grades as estimates.</strong> A-grade legs are model opinions, not locks.
        </li>
        <li>
          <strong>Read fade alerts as caution flags</strong>, not betting instructions.
        </li>
        <li>
          <strong>Use bankroll tools</strong> to size responsibly — never wager money you cannot
          afford to lose.
        </li>
        <li>
          <strong>Track your results.</strong> SLIPPR bet history and track record help you see
          real performance, not just highlights.
        </li>
        <li>
          <strong>Skip thin slates.</strong> When the board is small or council agreement is low,
          the right play is often no play.
        </li>
      </ul>

      <h2>Warning Signs</h2>
      <p>Consider seeking help if you:</p>
      <ul>
        <li>Bet more than you planned or chase losses</li>
        <li>Hide gambling from family or friends</li>
        <li>Borrow money or neglect obligations to wager</li>
        <li>Feel anxious or irritable when not betting</li>
      </ul>

      <h2>Get Help</h2>
      <div className="not-prose my-8 space-y-3">
        {RESOURCES.map((r) => (
          <div
            key={r.name}
            className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-5 py-4"
          >
            <p className="font-medium text-zinc-200">{r.name}</p>
            <a
              href={r.tel}
              className="mt-1 block font-mono text-emerald-400 hover:text-emerald-300 transition"
            >
              {r.phone}
            </a>
            <p className="mt-1 text-sm text-zinc-500">{r.note}</p>
          </div>
        ))}
      </div>

      <h2>Self-Exclusion</h2>
      <p>
        If you use legal sportsbooks, most state-regulated operators offer deposit limits, time
        limits, and self-exclusion programs. Contact your state gaming commission or sportsbook
        directly for options in your area.
      </p>

      <p className="legal-muted mt-12">
        See also: <Link href="/legal/terms">Terms of Service</Link>
      </p>
    </article>
  );
}
