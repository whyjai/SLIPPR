'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2, Lock, Sparkles } from 'lucide-react';
import { Badge, Card, PageHeader, SectionLabel, Toggle, cn } from './ui';
import { useAuth } from '../AuthProvider';
import { useUpgrade } from '../UpgradeProvider';
import type { LegBoardResult, MarketType, Sport } from '@/lib/leg-board';
import {
  MULTIPLIER_PRESETS,
  buildSlip,
  type RiskProfile,
  type SlipParams,
} from '@/lib/slip-optimizer';

const MARKET_LABELS: Record<MarketType, string> = {
  moneyline: 'Moneyline',
  spread: 'Spread',
  total: 'Total O/U',
  player_prop: 'Player Prop',
};

const RISK_LABELS: Record<RiskProfile, { label: string; desc: string }> = {
  safe: { label: 'Safe', desc: 'Max win probability' },
  balanced: { label: 'Balanced', desc: 'Probability × edge' },
  aggressive: { label: 'Aggressive', desc: 'Max edge & payout' },
};

const GRADE_TONES: Record<string, 'emerald' | 'violet' | 'zinc' | 'amber' | 'rose'> = {
  'A+': 'emerald',
  A: 'emerald',
  'B+': 'violet',
  B: 'zinc',
  C: 'amber',
  D: 'rose',
};

export default function SlipBuilderView() {
  const { isPro } = useAuth();
  const { goPro, checkoutPending } = useUpgrade();
  const [board, setBoard] = useState<LegBoardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const [target, setTarget] = useState<number>(5);
  const [maxLegs, setMaxLegs] = useState(4);
  const [minConfidence, setMinConfidence] = useState(65);
  const [risk, setRisk] = useState<RiskProfile>('balanced');
  const [sports, setSports] = useState<Sport[] | null>(null);
  const [markets, setMarkets] = useState<MarketType[] | null>(null);
  const [allowSameEvent, setAllowSameEvent] = useState(false);

  useEffect(() => {
    fetch('/api/legs')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: LegBoardResult | null) => {
        if (json) setBoard(json);
      })
      .finally(() => setLoading(false));
  }, []);

  const availableSports = useMemo(
    () => (board ? [...new Set(board.legs.map((l) => l.sport))] : []),
    [board],
  );

  const params: SlipParams = useMemo(
    () => ({
      targetMultiplier: target,
      maxLegs,
      minConfidence,
      sports,
      markets,
      allowSameEvent,
      riskProfile: risk,
    }),
    [target, maxLegs, minConfidence, sports, markets, allowSameEvent, risk],
  );

  const slip = useMemo(
    () => (board ? buildSlip(board.legs, params) : null),
    [board, params],
  );

  const toggleSport = (s: Sport) => {
    setSports((prev) => {
      if (!prev) return [s];
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      return next.length === 0 ? null : next;
    });
  };

  const toggleMarket = (m: MarketType) => {
    setMarkets((prev) => {
      if (!prev) return [m];
      const next = prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m];
      return next.length === 0 ? null : next;
    });
  };

  const copySlip = () => {
    if (!slip) return;
    const text = [
      `SLIPPR ${target}x Slip — Grade ${slip.grade} (${slip.americanOdds})`,
      ...slip.legs.map((l) => `• ${l.pick} (${l.americanOdds > 0 ? '+' : ''}${l.americanOdds} @ ${l.book})`),
      `Joint probability ${slip.jointFairProb}% · EV ${(slip.expectedValue * 100).toFixed(1)}%`,
    ].join('\n');
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Pro Feature"
          title="Slip builder"
          description="Set your target and risk profile — the optimizer assembles the highest-probability slip from today's 50-leg board."
          actions={<Badge className="self-start sm:self-auto">Included with Pro</Badge>}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Parameters */}
          <Card className="animate-fade-up delay-75 space-y-7 p-6 sm:p-8 lg:col-span-5">
            <div>
              <SectionLabel className="mb-3">Target Multiplier</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                {MULTIPLIER_PRESETS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setTarget(m)}
                    className={cn(
                      'rounded-xl border py-3 font-mono text-sm font-semibold transition-all duration-200',
                      target === m
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                        : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-white/20',
                    )}
                  >
                    {m}x
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel className="mb-3">Risk Profile</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(RISK_LABELS) as RiskProfile[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRisk(r)}
                    className={cn(
                      'rounded-xl border px-2 py-3 text-center transition-all duration-200',
                      risk === r
                        ? 'border-emerald-500/50 bg-emerald-500/10'
                        : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20',
                    )}
                  >
                    <div className={cn('text-sm font-semibold', risk === r ? 'text-emerald-300' : 'text-zinc-300')}>
                      {RISK_LABELS[r].label}
                    </div>
                    <div className="mt-0.5 text-[10px] text-zinc-500">{RISK_LABELS[r].desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <SectionLabel>Min Council Confidence</SectionLabel>
                <span className="font-mono text-sm text-emerald-400">{minConfidence}</span>
              </div>
              <input
                type="range"
                min={55}
                max={85}
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <SectionLabel>Max Legs</SectionLabel>
                <span className="font-mono text-sm text-emerald-400">{maxLegs}</span>
              </div>
              <input
                type="range"
                min={2}
                max={8}
                value={maxLegs}
                onChange={(e) => setMaxLegs(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <div>
              <SectionLabel className="mb-3">Sports</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {availableSports.map((s) => (
                  <button
                    key={s}
                    onClick={() => toggleSport(s)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
                      !sports || sports.includes(s)
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-white/[0.08] bg-white/[0.02] text-zinc-500',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel className="mb-3">Markets</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(MARKET_LABELS) as MarketType[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => toggleMarket(m)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
                      !markets || markets.includes(m)
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-white/[0.08] bg-white/[0.02] text-zinc-500',
                    )}
                  >
                    {MARKET_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/[0.05] pt-5">
              <div>
                <h3 className="text-sm font-medium text-zinc-200">Allow same-game legs</h3>
                <p className="text-xs text-zinc-500">Correlated parlays get flagged</p>
              </div>
              <Toggle checked={allowSameEvent} onChange={setAllowSameEvent} label="Allow same-game legs" />
            </div>
          </Card>

          {/* Built slip */}
          <div className="lg:col-span-7">
            {loading ? (
              <div className="skeleton h-96" />
            ) : !isPro ? (
              <Card className="animate-fade-up delay-150 relative overflow-hidden">
                {slip && (
                  <div className="pointer-events-none select-none blur-md">
                    <div className="border-b border-white/[0.06] p-6 sm:p-7">
                      <div className="mb-1 flex items-center gap-2.5">
                        <Sparkles className="h-4 w-4 text-emerald-400" />
                        <span className="text-sm font-medium text-zinc-300">Optimized Slip</span>
                        <Badge tone={GRADE_TONES[slip.grade]}>Grade {slip.grade}</Badge>
                      </div>
                      <div className="font-mono text-4xl font-bold tracking-tight text-white">
                        {slip.americanOdds}
                        <span className="ml-2 text-lg font-normal text-zinc-500">{slip.decimalOdds}x</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 divide-x divide-white/[0.06]">
                      {slip.legs.slice(0, 3).map((leg) => (
                        <div key={leg.id} className="p-5 text-center text-xs text-zinc-500">
                          {leg.sport}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-[#0c0c0f]/70 to-[#0c0c0f]/95 p-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/25">
                    <Lock className="h-6 w-6 text-emerald-400" />
                  </div>
                  <div>
                    <p className="mb-1 font-semibold text-zinc-100">The Slip Builder is a Pro feature</p>
                    <p className="mx-auto max-w-sm text-sm text-zinc-500">
                      Set any multiplier and risk profile — Pro assembles the highest-probability
                      slip from today&apos;s full 50-leg board.
                    </p>
                  </div>
                  <button
                    onClick={() => void goPro()}
                    disabled={checkoutPending}
                    className="btn-primary px-7 py-3"
                  >
                    {checkoutPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Unlock Slip Builder — $19/mo
                  </button>
                </div>
              </Card>
            ) : !slip ? (
              <Card className="animate-fade-up delay-150 p-12 text-center">
                <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-amber-400" />
                <p className="mb-1 font-medium text-zinc-300">No slip possible with these filters</p>
                <p className="text-sm text-zinc-600">
                  Lower the minimum confidence or add more sports and markets.
                </p>
              </Card>
            ) : (
              <Card className="animate-fade-up delay-150 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] p-6 sm:p-7">
                  <div>
                    <div className="mb-1 flex items-center gap-2.5">
                      <Sparkles className="h-4 w-4 text-emerald-400" />
                      <span className="text-sm font-medium text-zinc-300">Optimized Slip</span>
                      <Badge tone={GRADE_TONES[slip.grade]}>Grade {slip.grade}</Badge>
                    </div>
                    <div className="font-mono text-4xl font-bold tracking-tight text-white">
                      {slip.americanOdds}
                      <span className="ml-2 text-lg font-normal text-zinc-500">
                        {slip.decimalOdds}x
                      </span>
                    </div>
                  </div>
                  <button onClick={copySlip} className="btn-ghost px-5 py-2.5 text-sm">
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied' : 'Copy Slip'}
                  </button>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 divide-x divide-white/[0.06] border-b border-white/[0.06]">
                  <Metric label="Joint Probability" value={`${slip.jointFairProb}%`} />
                  <Metric
                    label="Expected Value"
                    value={`${slip.expectedValue >= 0 ? '+' : ''}${(slip.expectedValue * 100).toFixed(1)}%`}
                    tone={slip.expectedValue >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                  />
                  <Metric label="Suggested Stake" value={`${slip.kellyStakePct}%`} sub="¼-Kelly of bankroll" />
                </div>

                {/* Legs */}
                <div className="divide-y divide-white/[0.04]">
                  {slip.legs.map((leg) => (
                    <div key={leg.id} className="flex items-center gap-4 px-6 py-4">
                      <Badge tone="zinc" className="!px-2 !text-[10px]">{leg.sport}</Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-zinc-100">{leg.pick}</div>
                        <div className="truncate text-xs text-zinc-500">
                          {leg.event} · {leg.book}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm text-zinc-200">
                          {leg.americanOdds > 0 ? `+${leg.americanOdds}` : leg.americanOdds}
                        </div>
                        <div className="font-mono text-[11px] text-zinc-500">
                          {leg.fairProb}% fair · {leg.confidence} conf
                        </div>
                      </div>
                      <Badge tone={GRADE_TONES[leg.grade] ?? 'zinc'}>{leg.grade}</Badge>
                    </div>
                  ))}
                </div>

                {slip.warnings.length > 0 && (
                  <div className="space-y-2 border-t border-white/[0.06] bg-amber-500/[0.04] px-6 py-4">
                    {slip.warnings.map((w, i) => (
                      <p key={i} className="flex gap-2 text-xs leading-relaxed text-amber-300/90">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {w}
                      </p>
                    ))}
                  </div>
                )}
              </Card>
            )}

            <p className="mt-5 text-center text-[11px] leading-relaxed text-zinc-600">
              Joint probability assumes independent legs. EV is measured against devigged consensus prices.
              Nothing here is financial advice. 21+ · 1-800-GAMBLER.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="px-5 py-4 text-center">
      <div className={cn('font-mono text-xl font-bold', tone ?? 'text-zinc-100')}>{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      {sub && <div className="text-[10px] text-zinc-600">{sub}</div>}
    </div>
  );
}
