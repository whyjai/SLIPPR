import Link from 'next/link';
import type { Metadata } from 'next';
import { FileText, HeartHandshake, Shield } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Legal',
  description: 'SLIPPR terms, responsible play resources, and compliance information.',
};

const links = [
  {
    href: '/legal/terms',
    title: 'Terms of Service',
    description:
      'Subscription terms, informational-use policy, and liability limits for SLIPPR analytics.',
    icon: FileText,
  },
  {
    href: '/legal/responsible-play',
    title: 'Responsible Play',
    description:
      'Age requirements, problem gambling resources, and how to use SLIPPR as a research tool.',
    icon: HeartHandshake,
  },
];

export default function LegalIndexPage() {
  return (
    <div>
      <div className="mb-10">
        <p className="eyebrow mb-3">Legal & Compliance</p>
        <h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">Legal Center</h1>
        <p className="leading-relaxed text-zinc-400">
          SLIPPR provides sports handicapping and analytics research for{' '}
          <strong className="font-medium text-zinc-300">informational purposes only</strong>.
          We are not a sportsbook and do not accept or place wagers on your behalf.
        </p>
      </div>

      <div className="mb-10 flex items-start gap-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-5">
        <Shield className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
        <p className="text-sm leading-relaxed text-zinc-300">
          You are solely responsible for determining whether sports wagering is legal in your
          jurisdiction and for acting only through licensed operators where permitted. Model
          grades, fade alerts, and council outputs are probabilistic estimates — not guarantees.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {links.map(({ href, title, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="pg-card pg-card-hover group block p-6 transition"
          >
            <Icon className="mb-4 h-6 w-6 text-emerald-400 transition group-hover:scale-105" />
            <h2 className="mb-2 font-semibold text-white group-hover:text-emerald-300 transition">
              {title}
            </h2>
            <p className="text-sm leading-relaxed text-zinc-500">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
