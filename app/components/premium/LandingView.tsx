'use client';

import {
  ArrowRight,
  Award,
  Check,
  Loader2,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { Card, SectionLabel } from './ui';
import { useUpgrade } from '../UpgradeProvider';

type LandingViewProps = {
  onOpenDashboard: () => void;
  onOpenBoard?: () => void;
};

const stats = [
  { label: 'Legs Graded Daily', value: '50', sub: 'All sports & markets' },
  { label: 'Models Active', value: '10+', sub: 'Parallel grading' },
  { label: 'Daily Refreshes', value: '8×', sub: 'Every 3 hours' },
  { label: 'Books Compared', value: '6+', sub: 'Devigged consensus' },
];

const features = [
  {
    icon: Award,
    title: 'AI Council Consensus',
    desc: '10 models debate every leg independently. Only high-agreement slips make the board.',
  },
  {
    icon: TrendingUp,
    title: 'Sharp vs Public',
    desc: 'See where smart money is flowing — and where the public is walking into traps.',
  },
  {
    icon: Shield,
    title: 'Predatory Line Detector',
    desc: 'High juice, correlated legs, and public-heavy favorites flagged before you bet.',
  },
  {
    icon: Zap,
    title: 'Custom Slip Builder',
    desc: 'Pick a multiplier from 2x to 50x — the optimizer assembles the highest-probability slip from the board.',
  },
  {
    icon: Users,
    title: '50-Leg Daily Board',
    desc: 'Moneylines, spreads, totals, and player props across every in-season sport, ranked by edge.',
  },
  {
    icon: Sparkles,
    title: 'Full Transparency',
    desc: 'Every model grade, confidence score, and warning shown upfront. No black box.',
  },
];

const steps = [
  {
    n: '01',
    title: 'Council convenes',
    desc: 'Ten independent models grade every leg on fresh odds data, eight times a day.',
  },
  {
    n: '02',
    title: 'Consensus filters',
    desc: 'Disagreement kills a leg. Only slips with cross-model agreement survive.',
  },
  {
    n: '03',
    title: 'You bet protected',
    desc: 'Tiered slips, sharp-money signals, and predatory-line warnings — all in one board.',
  },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    highlight: false,
    cta: 'Get Started',
    features: ['3 Safe slips per day', 'Basic predatory warnings', 'Landing insights'],
  },
  {
    name: 'Pro',
    price: '$19',
    highlight: true,
    cta: 'Go Pro',
    features: [
      'Full 50-leg graded board',
      'Custom slip builder (2x–50x)',
      'Full AI Council transparency',
      'Sharp vs Public panel',
      'Bankroll tools + bet history',
      'Email slips 8× daily',
    ],
  },
];

export default function LandingView({ onOpenDashboard, onOpenBoard }: LandingViewProps) {
  const { goPro, requireAuth, checkoutPending } = useUpgrade();
  return (
    <div className="relative overflow-hidden">
      <div className="hero-glow pointer-events-none absolute inset-0" />
      <div className="grid-lines pointer-events-none absolute inset-x-0 top-0 h-[640px]" />

      {/* Hero */}
      <section className="relative px-6 pb-24 pt-24 sm:pt-32 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <div className="animate-fade-up mb-8 inline-flex items-center gap-2.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-4 py-1.5 text-sm text-emerald-300">
            <span className="live-dot" />
            AI Council live — 10 models analyzing today&apos;s slate
          </div>

          <h1 className="animate-fade-up delay-75 mb-6 text-4xl font-bold leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
            Parlay slips that
            <span className="text-gradient block">beat the books.</span>
          </h1>

          <p className="animate-fade-up delay-150 mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-zinc-400 sm:text-xl">
            SLIPPR runs a multi-model AI council on fresh odds data, surfaces
            consensus slips, and protects you from predatory lines — refreshed
            eight times daily.
          </p>

          <div className="animate-fade-up delay-225 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              onClick={() => requireAuth('Create your free SLIPPR account.')}
              className="btn-primary px-8 py-4 text-base"
            >
              Start Free <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={onOpenBoard ?? onOpenDashboard}
              className="btn-ghost px-8 py-4 text-base"
            >
              See the Live Board
            </button>
          </div>

          <div className="animate-fade-up delay-300 mt-10 flex flex-wrap justify-center gap-x-7 gap-y-2 text-xs text-zinc-500">
            {['Verified council grades', 'Cancel anytime', 'Web + mobile ready'].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" /> {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="relative px-6 pb-24 lg:px-10">
        <Card className="animate-fade-up delay-375 mx-auto grid max-w-5xl grid-cols-2 divide-y divide-white/[0.06] sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {stats.map((stat) => (
            <div key={stat.label} className="px-8 py-8 text-center">
              <div className="mb-1 font-mono text-3xl font-bold text-emerald-400 sm:text-4xl">
                {stat.value}
              </div>
              <div className="text-sm font-medium text-white">{stat.label}</div>
              <div className="mt-1 text-xs text-zinc-500">{stat.sub}</div>
            </div>
          ))}
        </Card>
      </section>

      {/* Features */}
      <section id="features" className="relative border-t border-white/[0.05] px-6 py-24 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <SectionLabel className="mb-3">The Platform</SectionLabel>
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Built for serious bettors
            </h2>
            <p className="mx-auto max-w-xl leading-relaxed text-zinc-400">
              Everything you need to find edge, avoid traps, and bet with confidence.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, desc }) => (
              <Card key={title} hover className="p-7">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
                  <Icon className="h-5 w-5 text-emerald-400" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">{desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative border-t border-white/[0.05] px-6 py-24 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <SectionLabel className="mb-3">How It Works</SectionLabel>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              From raw odds to protected slips
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {steps.map((step) => (
              <Card key={step.n} className="relative p-7">
                <span className="font-mono text-sm font-semibold text-emerald-500/60">
                  {step.n}
                </span>
                <h3 className="mb-2 mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">{step.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative border-t border-white/[0.05] px-6 py-24 lg:px-10">
        <div className="mx-auto max-w-4xl">
          <div className="mb-12 text-center">
            <SectionLabel className="mb-3">Pricing</SectionLabel>
            <h2 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Simple pricing. Real edge.
            </h2>
            <p className="text-zinc-400">Start free. Upgrade when you want the full council.</p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {plans.map((plan) => (
              <Card
                key={plan.name}
                className={plan.highlight ? 'pg-glow-ring bg-emerald-500/[0.04] p-8' : 'p-8'}
              >
                {plan.highlight && (
                  <span className="eyebrow mb-4 block">Recommended</span>
                )}
                <div className="mb-1 text-sm text-zinc-400">{plan.name}</div>
                <div className="mb-7 text-5xl font-bold tracking-tight">
                  {plan.price}
                  <span className="text-lg font-normal text-zinc-500">/mo</span>
                </div>
                <ul className="mb-8 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-zinc-300">
                      <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={plan.highlight ? () => void goPro() : () => requireAuth()}
                  disabled={plan.highlight && checkoutPending}
                  className={`${plan.highlight ? 'btn-primary' : 'btn-ghost'} w-full py-3`}
                >
                  {plan.highlight && checkoutPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {plan.cta}
                </button>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative px-6 py-24 lg:px-10">
        <Card className="mx-auto max-w-3xl p-10 text-center sm:p-14">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/25">
            <Shield className="h-7 w-7 text-emerald-400" />
          </div>
          <h2 className="mb-4 text-3xl font-bold tracking-tight">
            Stop guessing. Start winning.
          </h2>
          <p className="mb-8 leading-relaxed text-zinc-400">
            Join bettors using AI council consensus to gain a real edge over the books.
          </p>
          <button onClick={onOpenDashboard} className="btn-primary px-8 py-4">
            Open Dashboard <ArrowRight className="h-4 w-4" />
          </button>
        </Card>
      </section>
    </div>
  );
}
