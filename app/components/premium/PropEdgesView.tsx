'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Crosshair, Loader2, Lock, RefreshCw } from 'lucide-react';
import { Badge, Card, PageHeader, Toggle, cn } from './ui';
import { useAuth } from '../AuthProvider';
import { useUpgrade } from '../UpgradeProvider';
import { todayEtLabel } from '@/lib/slate';
import type { PropEdge, PropEdgesResult } from '@/lib/prop-edges';

const FREE_VISIBLE = 5;

type SortKey = 'edge' | 'win' | 'start';

/** One play (player + market + side), with every platform offering it ranked. */
type PlayGroup = {
  key: string;
  best: PropEdge;
  others: PropEdge[];
};

function fmtOdds(n: number | null): string {
  if (n == null) return '';
  return n > 0 ? `+${n}` : `${n}`;
}

function edgeTone(edge: number): 'emerald' | 'violet' | 'zinc' {
  if (edge >= 5) return 'emerald';
  if (edge >= 3) return 'violet';
  return 'zinc';
}

export default function PropEdgesView() {
  const { isPro } = useAuth();
  const { goPro, checkoutPending } = useUpgrade();
  const [data, setData] = useState<PropEdgesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [platforms, setPlatforms] = useState<Set<string>>(new Set());
  const [sport, setSport] = useState<string | null>(null);
  const [exactOnly, setExactOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('edge');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/props')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: PropEdgesResult | null) => {
        if (json) setData(json);
      })
      .finally(() => setLoading(false));
  }, []);

  const allPlatforms = useMemo(
    () => (data ? [...new Set(data.edges.map((e) => e.platform))].sort() : []),
    [data],
  );
  const sports = useMemo(() => (data ? [...new Set(data.edges.map((e) => e.sport))] : []), [data]);

  const groups = useMemo<PlayGroup[]>(() => {
    if (!data) return [];
    const byPlay = new Map<string, PropEdge[]>();
    for (const e of data.edges) {
      if (platforms.size > 0 && !platforms.has(e.platform)) continue;
      if (sport && e.sport !== sport) continue;
      if (exactOnly && data.source === 'live' && e.lineMatch !== 'exact') continue;
      const k = `${e.event}|${e.player}|${e.market}|${e.side}`;
      byPlay.set(k, [...(byPlay.get(k) ?? []), e]);
    }
    const list = [...byPlay.entries()].map(([key, edges]) => {
      const sorted = edges.sort((a, b) => b.edge - a.edge);
      return { key, best: sorted[0], others: sorted.slice(1) };
    });
    return list.sort((a, b) => {
      if (sortKey === 'win') return b.best.winProb - a.best.winProb;
      if (sortKey === 'start') return a.best.startTime.localeCompare(b.best.startTime);
      return b.best.edge - a.best.edge;
    });
  }, [data, platforms, sport, exactOnly, sortKey]);

  const visible = isPro ? groups : groups.slice(0, FREE_VISIBLE);
  const lockedCount = groups.length - visible.length;

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Pick'em vs Sharp"
          title={`Prop Edges · ${todayEtLabel()}`}
          description="Every PrizePicks, Underdog, Pick6, Betr and Fliff prop checked against no-vig Pinnacle-weighted sharp lines. Edge = true win % minus what that app needs you to hit."
          actions={
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-sm text-zinc-400">
              <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />
              Rescans with the board
            </div>
          }
        />

        {data && (data.source === 'live' || data.source === 'sharp-only') && (
          <div className="animate-fade-up mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
            {data.source === 'live' ? <Badge>Live Lines</Badge> : <Badge tone="amber">Sharp Only</Badge>}
            <span>Sharp: {data.sharpBooksSeen.join(', ') || '—'}</span>
            <span className="font-mono">Updated {new Date(data.generatedAt).toLocaleTimeString()}</span>
          </div>
        )}

        {data?.source === 'sharp-only' && (
          <Card className="animate-fade-up mb-6 border-amber-500/20 bg-amber-500/[0.04] p-4">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-200/80">
                Pick&apos;em lines are unavailable right now, so these are Pinnacle&apos;s strongest sides priced
                against the best pick&apos;em breakeven. Before entering, confirm your app posts the{' '}
                <strong>same line</strong> as a <strong>standard</strong>{' '}
                pick (not a goblin/demon or reduced multiplier) — if it doesn&apos;t, the edge isn&apos;t there.
              </p>
            </div>
          </Card>
        )}

        {/* Breakeven legend */}
        {data && Object.keys(data.breakevens).length > 0 && (
          <Card className="animate-fade-up mb-6 border-emerald-500/15 bg-emerald-500/[0.03] p-4">
            <p className="mb-3 text-sm font-medium text-emerald-300">What each app needs you to hit per pick</p>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {Object.entries(data.breakevens).map(([name, be]) => (
                <div key={name} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
                  <p className="text-xs font-medium text-zinc-200">{name}</p>
                  <p className="font-mono text-[11px] text-zinc-500">{be == null ? 'uses odds' : `${be.toFixed(1)}%`}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              Based on each app&apos;s best standard entry (5–6 pick Flex on PrizePicks/Underdog). Only stack plays
              with 3%+ edge — edges don&apos;t survive weak legs in the same entry.
            </p>
          </Card>
        )}

        {/* Filters */}
        {data && data.edges.length > 0 && (
          <div className="animate-fade-up delay-75 mb-6 flex flex-wrap items-center gap-2">
            <FilterChip label="All Apps" active={platforms.size === 0} onClick={() => setPlatforms(new Set())} />
            {allPlatforms.map((p) => (
              <FilterChip key={p} label={p} active={platforms.has(p)} onClick={() => togglePlatform(p)} />
            ))}
            <span className="mx-2 hidden h-4 w-px bg-white/10 sm:block" />
            <FilterChip label="All Sports" active={!sport} onClick={() => setSport(null)} />
            {sports.map((s) => (
              <FilterChip key={s} label={s} active={sport === s} onClick={() => setSport(sport === s ? null : s)} />
            ))}
            <span className="ml-auto flex items-center gap-4 text-xs text-zinc-500">
              {data.source === 'live' && (
                <span className="flex items-center gap-2">
                  Same line only
                  <Toggle checked={exactOnly} onChange={setExactOnly} label="Only show plays where the sharp line matches" />
                </span>
              )}
              <span className="flex items-center gap-2">
                Sort
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none"
                >
                  <option value="edge">Edge</option>
                  <option value="win">Win %</option>
                  <option value="start">Start time</option>
                </select>
              </span>
            </span>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-16" />
            ))}
          </div>
        ) : !data || data.edges.length === 0 ? (
          <Card className="animate-fade-up p-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <Crosshair className="h-7 w-7 text-emerald-400" />
            </div>
            <p className="mb-2 font-medium text-zinc-300">No prop edges right now</p>
            <p className="mx-auto max-w-sm text-sm text-zinc-600">
              {data?.message ?? 'Prop scan unavailable right now.'}
            </p>
          </Card>
        ) : groups.length === 0 ? (
          <Card className="p-10 text-center text-sm text-zinc-500">No plays match these filters.</Card>
        ) : (
          <div className="space-y-2.5">
            {visible.map((g) => (
              <PlayRow
                key={g.key}
                group={g}
                expanded={expanded === g.key}
                onToggle={() => setExpanded(expanded === g.key ? null : g.key)}
              />
            ))}
            {lockedCount > 0 && (
              <Card className="relative overflow-hidden">
                <div className="flex flex-col items-center justify-center gap-3 py-10">
                  <div className="flex items-center gap-2 text-sm text-zinc-300">
                    <Lock className="h-4 w-4 text-emerald-400" />
                    {lockedCount} more prop edges today
                  </div>
                  <button onClick={() => void goPro()} disabled={checkoutPending} className="btn-primary px-6 py-2.5 text-sm">
                    {checkoutPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Unlock All — Go Pro · $19/mo
                  </button>
                </div>
              </Card>
            )}
          </div>
        )}

        <p className="mt-8 text-[11px] leading-relaxed text-zinc-600">
          Informational research only. Win % is a no-vig sharp-market estimate, not a guarantee. Lines marked
          &quot;est.&quot; differ from the sharp line and use a modeled adjustment. Payout tables change — confirm in
          your app before entering.
        </p>
      </div>
    </div>
  );
}

function PlayRow({
  group,
  expanded,
  onToggle,
}: {
  group: PlayGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { best, others } = group;
  const start = new Date(best.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <Card className="animate-fade-up overflow-hidden" hover>
      <button
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 text-left sm:flex-nowrap"
      >
        <Badge tone={edgeTone(best.edge)} className="!min-w-[4.25rem] justify-center font-mono">
          +{best.edge.toFixed(1)}%
        </Badge>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">
            {best.player}{' '}
            <span className={best.side === 'over' ? 'text-emerald-300' : 'text-sky-300'}>
              {best.side === 'over' ? 'Over' : 'Under'} {best.line}
            </span>{' '}
            {best.market}
            {best.lineMatch === 'estimated' && (
              <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-amber-400/80">est.</span>
            )}
            {best.lineMatch === 'unverified' && (
              <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-amber-400/80">verify line</span>
            )}
          </p>
          <p className="truncate text-xs text-zinc-500">
            {[best.sport, best.event, start].filter(Boolean).join(' · ')}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Take at</p>
            <p className="text-sm font-semibold text-emerald-300">
              {best.platform}
              {best.price != null && <span className="ml-1.5 font-mono text-xs text-zinc-400">{fmtOdds(best.price)}</span>}
            </p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Win / need</p>
            <p className="font-mono text-sm text-zinc-200">
              {best.winProb}% <span className="text-zinc-600">/ {best.breakeven}%</span>
            </p>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
        </div>
      </button>

      {expanded && (
        <div className="grid gap-4 border-t border-white/[0.05] bg-black/20 px-4 py-4 text-xs sm:grid-cols-2">
          <div>
            <p className="mb-2 font-medium uppercase tracking-wider text-zinc-500">Sharp market</p>
            <ul className="space-y-1 font-mono text-zinc-300">
              {best.sharpLines.map((s) => (
                <li key={`${s.book}-${s.line}`}>
                  {s.book} · o{s.line} → {s.overProb}% over (no-vig)
                </li>
              ))}
            </ul>
            <p className="mt-2 text-zinc-500">
              Fair price for this side: <span className="font-mono text-zinc-300">{fmtOdds(best.fairOdds)}</span>
            </p>
          </div>
          <div>
            <p className="mb-2 font-medium uppercase tracking-wider text-zinc-500">Also available</p>
            {others.length === 0 ? (
              <p className="text-zinc-600">Only {best.platform} beats the market on this play.</p>
            ) : (
              <ul className="space-y-1">
                {others.map((o) => (
                  <li key={o.id} className="flex justify-between gap-3 font-mono text-zinc-300">
                    <span>
                      {o.platform} {o.side === 'over' ? 'o' : 'u'}
                      {o.line} {o.price != null && fmtOdds(o.price)}
                    </span>
                    <span className="text-zinc-500">+{o.edge.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
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
