'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Lock, RefreshCw } from 'lucide-react';
import { Badge, Card, PageHeader, cn } from './ui';
import { useAuth } from '../AuthProvider';
import { useUpgrade } from '../UpgradeProvider';
import type { BoardLeg, LegBoardResult, MarketType, Sport } from '@/lib/leg-board';

const DFS_SITES = new Set(['PrizePicks', 'Underdog']);

const FREE_VISIBLE = 15;

const MARKET_LABELS: Record<MarketType, string> = {
  moneyline: 'Moneyline',
  spread: 'Spread',
  total: 'Total O/U',
  player_prop: 'Player Prop',
};

const GRADE_TONES: Record<string, 'emerald' | 'amber' | 'zinc' | 'violet'> = {
  'A+': 'emerald',
  A: 'emerald',
  'B+': 'violet',
  B: 'zinc',
  C: 'amber',
};

type SortKey = 'confidence' | 'edge' | 'odds';

export default function LegBoardView() {
  const { isPro } = useAuth();
  const { goPro, checkoutPending } = useUpgrade();
  const [board, setBoard] = useState<LegBoardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [sportFilter, setSportFilter] = useState<Sport | null>(null);
  const [marketFilter, setMarketFilter] = useState<MarketType | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('confidence');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch('/api/legs')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: LegBoardResult | null) => {
        if (json) setBoard(json);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const sports = useMemo(
    () => (board ? [...new Set(board.legs.map((l) => l.sport))] : []),
    [board],
  );

  const filtered = useMemo(() => {
    if (!board) return [];
    const legs = board.legs.filter(
      (l) =>
        (!sportFilter || l.sport === sportFilter) &&
        (!marketFilter || l.market === marketFilter),
    );
    return legs.sort((a, b) => {
      if (sortKey === 'edge') return b.edge - a.edge;
      if (sortKey === 'odds') return b.americanOdds - a.americanOdds;
      return b.confidence - a.confidence;
    });
  }, [board, sportFilter, marketFilter, sortKey]);

  const visible = isPro ? filtered : filtered.slice(0, FREE_VISIBLE);
  const lockedCount = filtered.length - visible.length;

  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Today's Board"
          title="50 sharpest legs"
          description="Every in-season sport scanned — moneylines, spreads, totals, and player props — graded by the council and ranked by confidence and market edge."
          actions={
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-sm text-zinc-400">
              <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />
              Auto-refreshes 8×/day
            </div>
          }
        />

        {board && (
          <div className="animate-fade-up mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
            {board.source === 'live' ? (
              <Badge>Live Odds</Badge>
            ) : board.source === 'pending' ? (
              <Badge tone="amber">Warming up</Badge>
            ) : (
              <Badge tone="amber">Demo Data — awaiting API keys</Badge>
            )}
            <span className="flex items-center gap-2">
              <span className="live-dot" />
              {board.legs.length} legs graded · {board.refreshWindow}
            </span>
            {board.council.enabled && (
              <span>
                Council: {board.council.responded}/{board.council.seats.length || 10} models voted
              </span>
            )}
            <span className="font-mono">
              Updated {new Date(board.generatedAt).toLocaleTimeString()}
            </span>
          </div>
        )}

        {board && board.warnings.length > 0 && (
          <Card className="animate-fade-up mb-6 border-amber-500/20 bg-amber-500/[0.04] p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-amber-300">
                Predatory Line Warnings — sportsbooks & DFS apps
              </h2>
            </div>
            <ul className="space-y-2">
              {board.warnings.map((w, i) => (
                <li key={i} className="flex gap-2.5 text-xs leading-relaxed text-amber-200/80">
                  <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                  {w}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Filters */}
        <div className="animate-fade-up delay-75 mb-6 flex flex-wrap items-center gap-2">
          <FilterChip label="All Sports" active={!sportFilter} onClick={() => setSportFilter(null)} />
          {sports.map((s) => (
            <FilterChip
              key={s}
              label={s}
              active={sportFilter === s}
              onClick={() => setSportFilter(sportFilter === s ? null : s)}
            />
          ))}
          <span className="mx-2 hidden h-4 w-px bg-white/10 sm:block" />
          <FilterChip label="All Markets" active={!marketFilter} onClick={() => setMarketFilter(null)} />
          {(Object.keys(MARKET_LABELS) as MarketType[]).map((m) => (
            <FilterChip
              key={m}
              label={MARKET_LABELS[m]}
              active={marketFilter === m}
              onClick={() => setMarketFilter(marketFilter === m ? null : m)}
            />
          ))}
          <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
            Sort
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none"
            >
              <option value="confidence">Confidence</option>
              <option value="edge">Edge</option>
              <option value="odds">Payout</option>
            </select>
          </span>
        </div>

        {/* Board */}
        {loading && !board ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-16" />
            ))}
          </div>
        ) : board?.source === 'pending' ? (
          <Card className="animate-fade-up delay-150 p-12 text-center">
            <RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin text-emerald-400" />
            <p className="mb-1 font-medium text-zinc-300">The council is convening</p>
            <p className="mx-auto max-w-md text-sm text-zinc-600">
              Fresh legs are scanned and graded 8×/day at set times. The first board will
              appear here shortly.
            </p>
          </Card>
        ) : (
          <Card className="animate-fade-up delay-150 overflow-hidden">
            <div className="hidden grid-cols-12 gap-3 border-b border-white/[0.06] px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 md:grid">
              <span className="col-span-4">Pick</span>
              <span className="col-span-2">Market</span>
              <span className="col-span-1 text-right">Odds</span>
              <span className="col-span-1 text-right">Fair %</span>
              <span className="col-span-1 text-right">Edge</span>
              <span className="col-span-2 text-right">Council</span>
              <span className="col-span-1 text-right">Grade</span>
            </div>

            {visible.map((leg, i) => (
              <LegRow
                key={leg.id}
                leg={leg}
                index={i}
                councilSize={board && board.council.responded > 0 ? board.council.responded : 10}
                expanded={expanded === leg.id}
                onToggle={() => setExpanded(expanded === leg.id ? null : leg.id)}
              />
            ))}

            {lockedCount > 0 && (
              <div className="relative">
                <div className="pointer-events-none select-none blur-[6px]">
                  {filtered.slice(FREE_VISIBLE, FREE_VISIBLE + 3).map((leg, i) => (
                    <LegRow key={leg.id} leg={leg} index={i} councilSize={10} expanded={false} onToggle={() => {}} />
                  ))}
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-transparent via-[#0c0c0f]/80 to-[#0c0c0f]">
                  <div className="flex items-center gap-2 text-sm text-zinc-300">
                    <Lock className="h-4 w-4 text-emerald-400" />
                    {lockedCount} more graded legs on the full board
                  </div>
                  <button
                    onClick={() => void goPro()}
                    disabled={checkoutPending}
                    className="btn-primary px-6 py-2.5 text-sm"
                  >
                    {checkoutPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Unlock All 50 — Go Pro · $19/mo
                  </button>
                </div>
              </div>
            )}
          </Card>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-600">
          Council grades are probabilistic estimates, not guarantees. 21+. Bet responsibly — 1-800-GAMBLER.
        </p>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200',
        active
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-200',
      )}
    >
      {label}
    </button>
  );
}

function LegRow({
  leg,
  index,
  councilSize,
  expanded,
  onToggle,
}: {
  leg: BoardLeg;
  index: number;
  councilSize: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-white/[0.04] last:border-0">
      <button
        onClick={onToggle}
        className="grid w-full grid-cols-2 items-center gap-3 px-5 py-4 text-left transition hover:bg-white/[0.02] md:grid-cols-12"
        style={{ animationDelay: `${Math.min(index * 25, 300)}ms` }}
      >
        <div className="col-span-2 md:col-span-4">
          <div className="flex items-center gap-2">
            <Badge tone="zinc" className="!px-2 !text-[10px]">{leg.sport}</Badge>
            <span className="truncate text-sm font-medium text-zinc-100">{leg.pick}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">{leg.event}</div>
        </div>
        <span className="hidden text-xs text-zinc-400 md:col-span-2 md:block">
          {MARKET_LABELS[leg.market]}
          {DFS_SITES.has(leg.book) ? (
            <Badge tone="violet" className="mt-0.5 !px-1.5 !text-[9px]">
              {leg.book} · DFS
            </Badge>
          ) : (
            <span className="block text-[11px] text-zinc-600">{leg.book}</span>
          )}
        </span>
        <span className="text-right font-mono text-sm text-zinc-200 md:col-span-1">
          {leg.americanOdds > 0 ? `+${leg.americanOdds}` : leg.americanOdds}
        </span>
        <span className="hidden text-right font-mono text-sm text-zinc-400 md:col-span-1 md:block">
          {leg.fairProb}%
        </span>
        <span
          className={cn(
            'hidden text-right font-mono text-sm md:col-span-1 md:block',
            leg.edge > 0 ? 'text-emerald-400' : 'text-zinc-500',
          )}
        >
          {leg.edge > 0 ? '+' : ''}{leg.edge}
        </span>
        <span className="hidden text-right md:col-span-2 md:block">
          <span className="font-mono text-sm text-zinc-200">{leg.confidence}</span>
          <span className="ml-1.5 text-[11px] text-zinc-500">
            {leg.agreement}/{councilSize} agree
          </span>
        </span>
        <span className="flex items-center justify-end gap-2 md:col-span-1">
          <Badge tone={GRADE_TONES[leg.grade] ?? 'zinc'}>{leg.grade}</Badge>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-zinc-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="animate-fade-up border-t border-white/[0.04] bg-black/20 px-5 py-4">
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">{leg.reasoning}</p>
          <p className="mt-2 font-mono text-xs text-zinc-600">
            Best price at {leg.book} · implied {leg.impliedProb}% vs fair {leg.fairProb}% ·
            starts {new Date(leg.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      )}
    </div>
  );
}
