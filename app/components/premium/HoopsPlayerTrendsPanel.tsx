'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, cn } from './ui';
import type {
  HoopsAverages,
  HoopsGameLogEntry,
  HoopsPlayerTrend,
  HoopsPlayerTrends,
  HoopsUsageChange,
} from '@/lib/research/hoops-players';

type Pos = 'ALL' | 'G' | 'F' | 'C';
type StatKey = Exclude<keyof HoopsAverages, 'games' | 'starts'>;

const COLUMNS: Array<{ key: StatKey; label: string }> = [
  { key: 'min', label: 'Min' },
  { key: 'pts', label: 'Pts' },
  { key: 'reb', label: 'Reb' },
  { key: 'ast', label: 'Ast' },
  { key: 'fg3m', label: '3PM' },
  { key: 'pra', label: 'PRA' },
  { key: 'usage', label: 'Usg %' },
];

/** Hit-rate stats, with the step between thresholds. */
const HIT_STATS: Array<{ key: keyof HoopsGameLogEntry; label: string; step: number }> = [
  { key: 'pts', label: 'pts', step: 3 },
  { key: 'reb', label: 'reb', step: 2 },
  { key: 'ast', label: 'ast', step: 2 },
  { key: 'fg3m', label: '3PM', step: 1 },
  { key: 'pra', label: 'PRA', step: 4 },
];

const PAGE = 40;

export default function HoopsPlayerTrendsPanel({ league, season }: { league: 'nba' | 'wnba'; season: number }) {
  const [result, setResult] = useState<{ season: number; data?: HoopsPlayerTrends; error?: string } | null>(null);
  const [pos, setPos] = useState<Pos>('ALL');
  const [team, setTeam] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StatKey>('pra');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/${league}/players?season=${season}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setResult({ season, data: json as HoopsPlayerTrends });
      })
      .catch((e) => !cancelled && setResult({ season, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [league, season]);

  const loading = result?.season !== season;
  const data = result?.data ?? null;
  const teams = useMemo(() => (data ? [...new Set(data.players.map((p) => p.team))].sort() : []), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.players
      .filter(
        (p) =>
          (pos === 'ALL' || p.pos === pos) && (!team || p.team === team) && (!q || p.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => (b.season[sort] ?? -1) - (a.season[sort] ?? -1));
  }, [data, pos, team, query, sort]);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-14" />
        ))}
      </div>
    );
  }
  if (!loading && result?.error) {
    return (
      <Card className="p-10 text-center text-sm text-zinc-400">Couldn&apos;t load player data: {result.error}</Card>
    );
  }
  if (!data) return null;
  const prevLabel = league === 'nba' ? `${data.season - 2}-${String(data.season - 1).slice(2)}` : `${data.season - 1}`;

  return (
    <div>
      {(data.risers.length > 0 || data.fallers.length > 0) && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold">Biggest role changes vs. {prevLabel}</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Minutes per game and usage rate (share of team plays used while on the floor), 10+ games in both seasons.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Changes title="Rising" items={data.risers} up />
            <Changes title="Falling" items={data.fallers} up={false} />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-lg font-semibold">Player trends</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Per-game averages for {data.seasonLabel}; small figures underneath are {prevLabel}. Open a row for the last 10
          games and hit rates.
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2">
            <Search className="h-4 w-4 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Search a player"
              className="w-full bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
            />
          </label>
          <select
            value={team}
            onChange={(e) => {
              setTeam(e.target.value);
              setLimit(PAGE);
            }}
            className="rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-zinc-300 focus:outline-none"
          >
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as StatKey)}
            className="rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-zinc-300 focus:outline-none"
          >
            {COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                Sort: {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {(['ALL', 'G', 'F', 'C'] as Pos[]).map((p) => (
            <button
              key={p}
              onClick={() => {
                setPos(p);
                setLimit(PAGE);
              }}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200',
                pos === p
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-200',
              )}
            >
              {p === 'ALL' ? 'All positions' : { G: 'Guards', F: 'Forwards', C: 'Centers' }[p]}
            </button>
          ))}
        </div>

        <Card className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-[minmax(10rem,1.6fr)_2.5rem_repeat(7,minmax(3.2rem,1fr))_1.5rem] items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              <span>Player</span>
              <span className="text-right">GP</span>
              {COLUMNS.map((c) => (
                <span key={c.key} className="text-right">
                  {c.label}
                </span>
              ))}
              <span />
            </div>
            {rows.slice(0, limit).map((p) => (
              <Fragment key={p.id}>
                <button
                  onClick={() => setOpen(open === p.id ? null : p.id)}
                  className="grid w-full grid-cols-[minmax(10rem,1.6fr)_2.5rem_repeat(7,minmax(3.2rem,1fr))_1.5rem] items-center gap-2 border-b border-white/[0.04] px-4 py-2.5 text-left text-sm hover:bg-white/[0.02]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-zinc-100">{p.name}</span>
                    <span className="text-xs text-zinc-500">
                      {p.pos ?? '—'} · {p.team}
                    </span>
                  </span>
                  <span className="text-right font-mono text-xs text-zinc-500">{p.season.games}</span>
                  {COLUMNS.map((c) => (
                    <Stat key={c.key} now={p.season[c.key]} before={p.prior?.[c.key] ?? null} />
                  ))}
                  {open === p.id ? (
                    <ChevronUp className="h-4 w-4 text-zinc-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-zinc-500" />
                  )}
                </button>
                {open === p.id && <Detail player={p} />}
              </Fragment>
            ))}
            {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-zinc-500">No players match.</p>}
          </div>
        </Card>
        {rows.length > limit && (
          <button
            onClick={() => setLimit(limit + PAGE)}
            className="mt-3 w-full rounded-xl border border-white/[0.08] py-2.5 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Show more ({rows.length - limit} left)
          </button>
        )}
      </section>
    </div>
  );
}

function Stat({ now, before }: { now: number | null; before: number | null }) {
  const diff = now != null && before != null ? now - before : null;
  const meaningful = diff != null && Math.abs(diff) >= Math.max(1, Math.abs(before ?? 0) * 0.15);
  return (
    <span className="text-right">
      <span
        className={cn(
          'block font-mono text-zinc-200',
          meaningful && diff! > 0 && 'text-emerald-300',
          meaningful && diff! < 0 && 'text-rose-300',
        )}
      >
        {now ?? '—'}
      </span>
      <span className="block font-mono text-[10px] text-zinc-600">{before ?? ''}</span>
    </span>
  );
}

function Changes({ title, items, up }: { title: string; items: HoopsUsageChange[]; up: boolean }) {
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <Card className="p-4">
      <p
        className={cn('mb-3 flex items-center gap-2 text-sm font-semibold', up ? 'text-emerald-300' : 'text-rose-300')}
      >
        <Icon className="h-4 w-4" /> {title}
      </p>
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={`${c.id}-${c.metric}`} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              <span className="text-zinc-100">{c.name}</span>{' '}
              <span className="text-xs text-zinc-500">
                {c.pos ?? ''} · {c.team}
              </span>
            </span>
            <span className="shrink-0 font-mono text-xs text-zinc-400">
              {c.metric} {c.before} → <span className={up ? 'text-emerald-300' : 'text-rose-300'}>{c.now}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Detail({ player }: { player: HoopsPlayerTrend }) {
  const last5 = player.log.slice(0, 5);
  const other = player.log.filter((g) => g.team !== player.team);
  return (
    <div className="border-b border-white/[0.06] bg-black/30 px-4 py-4">
      <div className="mb-4 flex flex-wrap gap-2">
        {HIT_STATS.flatMap((s) => {
          // Anchor thresholds on the 10-game median so one outlier night doesn't set the line.
          const vals = player.log.map((g) => Number(g[s.key])).sort((a, b) => a - b);
          const mid = vals.length ? (vals[(vals.length - 1) >> 1] + vals[vals.length >> 1]) / 2 : 0;
          const base = Math.max(s.step, Math.round(mid / s.step) * s.step);
          return [base - s.step, base, base + s.step]
            .filter((t) => t >= 1)
            .map((t) => {
              const hit = (gs: HoopsGameLogEntry[]) => gs.filter((g) => Number(g[s.key]) >= t).length;
              return (
                <div key={`${s.key}-${t}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <p className="text-xs font-medium text-zinc-200">
                    {t}+ {s.label}
                  </p>
                  <p className="font-mono text-[11px] text-zinc-500">
                    {hit(last5)}/{last5.length} last {last5.length} · {hit(player.log)}/{player.log.length} last{' '}
                    {player.log.length}
                  </p>
                </div>
              );
            });
        })}
      </div>
      {other.length > 0 && (
        <p className="-mt-2 mb-4 text-xs text-amber-400/90">
          {other.length} of these {player.log.length} games were with{' '}
          {[...new Set(other.map((g) => g.team))].join(', ')}, and the hit rates include them.
        </p>
      )}
      <p className="mb-2 text-xs text-zinc-500">
        Last 5: {player.last5.min} min · {player.last5.pts} pts · {player.last5.reb} reb · {player.last5.ast} ast ·{' '}
        {player.last5.fg3m} 3PM{player.last5.usage != null && ` · ${player.last5.usage}% usage`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Date</th>
              <th className="pr-3 font-medium">Opp</th>
              {['Min', 'Pts', 'Reb', 'Ast', '3PM', 'PRA', 'FG'].map((h) => (
                <th key={h} className="pr-3 text-right font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono text-zinc-300">
            {player.log.map((g) => (
              <tr key={g.date} className="border-t border-white/[0.04]">
                <td className="py-1.5 pr-3 text-zinc-500">
                  {g.date.slice(5)}
                  {g.team !== player.team && <span className="text-amber-400/90"> · {g.team}</span>}
                </td>
                <td className="pr-3">
                  {g.home ? 'vs' : '@'} {g.opp}
                </td>
                <td className="pr-3 text-right">{g.min}</td>
                <td className="pr-3 text-right">{g.pts}</td>
                <td className="pr-3 text-right">{g.reb}</td>
                <td className="pr-3 text-right">{g.ast}</td>
                <td className="pr-3 text-right">{g.fg3m}</td>
                <td className="pr-3 text-right">{g.pra}</td>
                <td className="pr-3 text-right text-zinc-500">
                  {g.fgm}/{g.fga}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
