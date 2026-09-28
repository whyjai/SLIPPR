'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, cn } from './ui';
import type { Averages, GameLogEntry, NflPlayerTrends, PlayerTrend, Position, UsageChange } from '@/lib/research/nfl-players';
import type { PlayerSplits, SplitLine } from '@/lib/research/nfl-teams';

type Filter = 'ALL' | Position;
type StatKey = Exclude<keyof Averages, 'games'>;

type Column = { key: StatKey; label: string; pct?: boolean };

const COLUMNS: Record<Filter, Column[]> = {
  ALL: [
    { key: 'snapPct', label: 'Snap', pct: true },
    { key: 'targets', label: 'Tgt' },
    { key: 'recYds', label: 'Rec yds' },
    { key: 'carries', label: 'Car' },
    { key: 'rushYds', label: 'Rush yds' },
    { key: 'fpts', label: 'PPR' },
  ],
  QB: [
    { key: 'snapPct', label: 'Snap', pct: true },
    { key: 'passAtt', label: 'Att' },
    { key: 'passYds', label: 'Pass yds' },
    { key: 'passTd', label: 'Pass TD' },
    { key: 'rushYds', label: 'Rush yds' },
    { key: 'fpts', label: 'PPR' },
  ],
  RB: [
    { key: 'snapPct', label: 'Snap', pct: true },
    { key: 'carries', label: 'Car' },
    { key: 'rushYds', label: 'Rush yds' },
    { key: 'targets', label: 'Tgt' },
    { key: 'receptions', label: 'Rec' },
    { key: 'fpts', label: 'PPR' },
  ],
  WR: [
    { key: 'snapPct', label: 'Snap', pct: true },
    { key: 'targets', label: 'Tgt' },
    { key: 'targetShare', label: 'Tgt share', pct: true },
    { key: 'receptions', label: 'Rec' },
    { key: 'recYds', label: 'Rec yds' },
    { key: 'fpts', label: 'PPR' },
  ],
  TE: [],
};
COLUMNS.TE = COLUMNS.WR;

/** Stats worth a hit-rate check, by position, with the step between thresholds. */
const HIT_STATS: Record<Position, Array<{ key: keyof GameLogEntry; label: string; step: number }>> = {
  QB: [
    { key: 'passYds', label: 'pass yds', step: 25 },
    { key: 'rushYds', label: 'rush yds', step: 10 },
  ],
  RB: [
    { key: 'rushYds', label: 'rush yds', step: 10 },
    { key: 'receptions', label: 'rec', step: 1 },
  ],
  WR: [
    { key: 'receptions', label: 'rec', step: 1 },
    { key: 'recYds', label: 'rec yds', step: 10 },
  ],
  TE: [
    { key: 'receptions', label: 'rec', step: 1 },
    { key: 'recYds', label: 'rec yds', step: 10 },
  ],
};

const SORTS: Array<{ key: StatKey; label: string }> = [
  { key: 'fpts', label: 'PPR points' },
  { key: 'snapPct', label: 'Snap %' },
  { key: 'targets', label: 'Targets' },
  { key: 'targetShare', label: 'Target share' },
  { key: 'receptions', label: 'Receptions' },
  { key: 'recYds', label: 'Receiving yards' },
  { key: 'carries', label: 'Carries' },
  { key: 'rushYds', label: 'Rushing yards' },
  { key: 'passYds', label: 'Passing yards' },
];

const PAGE = 40;

const fmt = (v: number | null, pct?: boolean) => (v == null ? '—' : pct ? `${Math.round(v)}%` : `${v}`);

export default function PlayerTrendsPanel({ season }: { season: number }) {
  const [result, setResult] = useState<{ season: number; data?: NflPlayerTrends; error?: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [team, setTeam] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StatKey>('fpts');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/nfl/players?season=${season}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setResult({ season, data: json as NflPlayerTrends });
      })
      .catch((e) => !cancelled && setResult({ season, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [season]);

  const loading = result?.season !== season;
  const data = result?.data ?? null;

  const teams = useMemo(() => (data ? [...new Set(data.players.map((p) => p.team))].sort() : []), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.players
      .filter((p) => (filter === 'ALL' || p.position === filter) && (!team || p.team === team) && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => (b.season[sort] ?? -1) - (a.season[sort] ?? -1));
  }, [data, filter, team, query, sort]);

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
    return <Card className="p-10 text-center text-sm text-zinc-400">Couldn&apos;t load player data: {result.error}</Card>;
  }
  if (!data) return null;

  const columns = COLUMNS[filter];

  return (
    <div>
      {(data.risers.length > 0 || data.fallers.length > 0) && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold">Biggest usage changes vs. {data.season - 1}</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Target share, snap % and carries this season against last. Early-season averages can be skewed by one game —
            an injury exit halves a two-game snap %. Open a player for the game log.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <ChangeList title="Rising" items={data.risers} up />
            <ChangeList title="Falling" items={data.fallers} up={false} />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-lg font-semibold">Player trends</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Per-game averages this season. Small figures underneath are {data.season - 1} for comparison. Open a row for the
          game log and hit rates.
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
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                Sort: {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {(['ALL', 'QB', 'RB', 'WR', 'TE'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setLimit(PAGE);
              }}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200',
                filter === f
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-200',
              )}
            >
              {f === 'ALL' ? 'All positions' : f}
            </button>
          ))}
        </div>

        <Card className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[minmax(10rem,1.6fr)_2.5rem_repeat(6,minmax(3.5rem,1fr))_1.5rem] items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              <span>Player</span>
              <span className="text-right">GP</span>
              {columns.map((c) => (
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
                  className="grid w-full grid-cols-[minmax(10rem,1.6fr)_2.5rem_repeat(6,minmax(3.5rem,1fr))_1.5rem] items-center gap-2 border-b border-white/[0.04] px-4 py-2.5 text-left text-sm hover:bg-white/[0.02]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-zinc-100">{p.name}</span>
                    <span className="text-xs text-zinc-500">
                      {p.position} · {p.team}
                    </span>
                  </span>
                  <span className="text-right font-mono text-xs text-zinc-500">{p.season.games}</span>
                  {columns.map((c) => (
                    <StatCell key={c.key} player={p} col={c} />
                  ))}
                  {open === p.id ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
                </button>
                {open === p.id && <PlayerDetail player={p} season={season} />}
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

function StatCell({ player, col }: { player: PlayerTrend; col: Column }) {
  const now = player.season[col.key];
  const before = player.prior?.[col.key] ?? null;
  const diff = now != null && before != null ? now - before : null;
  // Only flag changes large enough to matter relative to the stat's size.
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
        {fmt(now, col.pct)}
      </span>
      <span className="block font-mono text-[10px] text-zinc-600">{before == null ? '' : fmt(before, col.pct)}</span>
    </span>
  );
}

function PlayerDetail({ player, season }: { player: PlayerTrend; season: number }) {
  const stats = HIT_STATS[player.position];
  const last5 = player.log.slice(0, 5);
  return (
    <div className="border-b border-white/[0.06] bg-black/30 px-4 py-4">
      <div className="mb-4 flex flex-wrap gap-2">
        {stats.flatMap((s) => {
          // Anchor on the 10-game median, not this season's average: two early games run hot or cold.
          const vals = player.log.map((g) => Number(g[s.key])).sort((a, b) => a - b);
          const mid = vals.length ? (vals[(vals.length - 1) >> 1] + vals[vals.length >> 1]) / 2 : 0;
          const base = Math.max(s.step, Math.round(mid / s.step) * s.step);
          return [base - s.step, base, base + s.step]
            .filter((t) => t >= s.step)
            .map((t) => {
              const hit = (gs: GameLogEntry[]) => gs.filter((g) => Number(g[s.key]) >= t).length;
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
      {(() => {
        // Older CDN responses lack `team`; treat those as same-team.
        const other = player.log.filter((g) => g.team && g.team !== player.team);
        if (!other.length) return null;
        const teams = [...new Set(other.map((g) => g.team))].join(', ');
        return (
          <p className="-mt-2 mb-4 text-xs text-amber-400/90">
            {other.length} of these {player.log.length} games were with {teams}, and the hit rates include them.
          </p>
        );
      })()}
      <LookSplits player={player} season={season} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Game</th>
              <th className="pr-3 font-medium">Opp</th>
              <th className="pr-3 text-right font-medium">Snap</th>
              {player.position === 'QB' ? (
                <>
                  <th className="pr-3 text-right font-medium">Att</th>
                  <th className="pr-3 text-right font-medium">Pass yds</th>
                  <th className="pr-3 text-right font-medium">Pass TD</th>
                  <th className="pr-3 text-right font-medium">Rush yds</th>
                </>
              ) : (
                <>
                  <th className="pr-3 text-right font-medium">Tgt</th>
                  <th className="pr-3 text-right font-medium">Rec</th>
                  <th className="pr-3 text-right font-medium">Rec yds</th>
                  <th className="pr-3 text-right font-medium">Car</th>
                  <th className="pr-3 text-right font-medium">Rush yds</th>
                </>
              )}
              <th className="text-right font-medium">PPR</th>
            </tr>
          </thead>
          <tbody className="font-mono text-zinc-300">
            {player.log.map((g) => (
              <tr key={`${g.season}-${g.week}`} className="border-t border-white/[0.04]">
                <td className="py-1.5 pr-3 text-zinc-500">
                  {g.season} W{g.week}
                  {g.team && g.team !== player.team && <span className="text-amber-400/90"> · {g.team}</span>}
                </td>
                <td className="pr-3">{g.opponent}</td>
                <td className="pr-3 text-right">{g.snapPct == null ? '—' : `${g.snapPct}%`}</td>
                {player.position === 'QB' ? (
                  <>
                    <td className="pr-3 text-right">{g.passAtt}</td>
                    <td className="pr-3 text-right">{g.passYds}</td>
                    <td className="pr-3 text-right">{g.passTd}</td>
                    <td className="pr-3 text-right">{g.rushYds}</td>
                  </>
                ) : (
                  <>
                    <td className="pr-3 text-right">{g.targets}</td>
                    <td className="pr-3 text-right">{g.receptions}</td>
                    <td className="pr-3 text-right">{g.recYds}</td>
                    <td className="pr-3 text-right">{g.carries}</td>
                    <td className="pr-3 text-right">{g.rushYds}</td>
                  </>
                )}
                <td className="text-right">{g.fpts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChangeList({ title, items, up }: { title: string; items: UsageChange[]; up: boolean }) {
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className={cn('h-4 w-4', up ? 'text-emerald-400' : 'text-rose-400')} />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-600">Nothing notable yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => {
            const pct = c.metric !== 'Carries per game';
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-zinc-200">
                    {c.name} <span className="text-xs font-normal text-zinc-500">{c.position} · {c.team}</span>
                  </span>
                  <span className="block text-xs text-zinc-500">{c.metric}</span>
                </span>
                <span className="shrink-0 font-mono text-xs">
                  <span className="text-zinc-500">{fmt(c.before, pct)} → </span>
                  <span className={up ? 'text-emerald-300' : 'text-rose-300'}>{fmt(c.now, pct)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** How the player has fared against specific defensive looks (last season + this season). */
function LookSplits({ player, season }: { player: PlayerTrend; season: number }) {
  const [splits, setSplits] = useState<PlayerSplits | null | 'error'>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/nfl/splits?season=${season}&player=${encodeURIComponent(player.id)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((json: PlayerSplits) => !cancelled && setSplits(json))
      .catch(() => !cancelled && setSplits('error'));
    return () => {
      cancelled = true;
    };
  }, [player.id, season]);

  if (splits === null) return <div className="skeleton mb-4 h-24" />;
  if (splits === 'error') return null;

  // Passing for QBs, rushing (box counts) first for RBs, receiving for everyone who's targeted.
  type Col = [string, (l: SplitLine) => string];
  const sections: Array<{ title: string; lines: SplitLine[]; cols: Col[]; league: SplitLine[]; leagueCol: Col }> = [];
  const passCols: Array<[string, (l: SplitLine) => string]> = [
    ['Dropbacks', (l) => `${l.dropbacks}`],
    ['Yds/att', (l) => `${l.ypa ?? '—'}`],
    ['Comp %', (l) => (l.compPct == null ? '—' : `${l.compPct}%`)],
    ['EPA/db', (l) => `${l.epaPerDropback != null && l.epaPerDropback > 0 ? '+' : ''}${l.epaPerDropback ?? '—'}`],
  ];
  const recCols: Array<[string, (l: SplitLine) => string]> = [
    ['Targets', (l) => `${l.targets}`],
    ['Catch %', (l) => `${l.catchRate}%`],
    ['Yds/target', (l) => `${l.ypt}`],
  ];
  const rushCols: Array<[string, (l: SplitLine) => string]> = [
    ['Carries', (l) => `${l.carries}`],
    ['Yds/carry', (l) => `${l.ypc}`],
  ];
  const lg = splits.league ?? { passing: [], receiving: [], rushing: [] }; // older cached responses lack it
  if (player.position === 'QB' && splits.passing.length)
    sections.push({ title: 'Passing', lines: splits.passing, cols: passCols, league: lg.passing, leagueCol: ['Lg yds/att', (l) => `${l.ypa ?? '—'}`] });
  if (player.position === 'RB' && splits.rushing.length)
    sections.push({ title: 'Rushing', lines: splits.rushing, cols: rushCols, league: lg.rushing, leagueCol: ['Lg yds/carry', (l) => `${l.ypc}`] });
  if (player.position !== 'QB' && splits.receiving.length)
    sections.push({ title: 'Receiving', lines: splits.receiving, cols: recCols, league: lg.receiving, leagueCol: ['Lg yds/target', (l) => `${l.ypt}`] });
  if (!sections.length) return null;

  const since = splits.seasons.length > 1 ? `${splits.seasons[0]}–${splits.seasons.at(-1)}` : `${splits.seasons[0] ?? ''}`;
  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        vs. defensive looks · {since} · man/zone from seasons with coverage data
        {splits.chartedThrough && (
          <>
            {' '}
            · {splits.chartedThrough.season} charted through Week {splits.chartedThrough.week}
            {splits.chartedThrough.partialGames > 0 && ` (+${splits.chartedThrough.partialGames})`}
          </>
        )}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {sections.map((sec) => (
          <div key={sec.title} className="overflow-x-auto rounded-lg border border-white/[0.06] bg-white/[0.02]">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-1.5 font-medium">{sec.title}</th>
                  {sec.cols.map(([h]) => (
                    <th key={h} className="px-3 py-1.5 text-right font-medium">
                      {h}
                    </th>
                  ))}
                  {sec.league.length > 0 && (
                    <th className="px-3 py-1.5 text-right font-medium text-zinc-600">{sec.leagueCol[0]}</th>
                  )}
                </tr>
              </thead>
              <tbody className="font-mono text-zinc-300">
                {sec.lines.map((l) => {
                  const n = l.dropbacks ?? l.targets ?? l.carries ?? 0;
                  // Below these, a split is mostly noise (scripts/research/audit-nfl.mts).
                  const thin = n < (l.dropbacks != null ? 100 : 30);
                  return (
                    <tr key={l.look} className={cn('border-t border-white/[0.04]', thin && 'text-zinc-600')}>
                      <td className="px-3 py-1.5 font-sans text-zinc-400">{l.label}</td>
                      {sec.cols.map(([h, f]) => (
                        <td key={h} className="px-3 py-1.5 text-right">
                          {f(l)}
                        </td>
                      ))}
                      {sec.league.length > 0 && (
                        <td className="px-3 py-1.5 text-right text-zinc-500">
                          {(() => {
                            const lgLine = sec.league.find((x) => x.look === l.look);
                            return lgLine ? sec.leagueCol[1](lgLine) : '—';
                          })()}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-zinc-600">
        Dimmed rows: small sample. A player&apos;s own split swings a lot from week to week (last season, blitz and
        man/zone splits barely repeated between halves of the season); the Lg column is what each look does on
        average, and is the steadier guide.
      </p>
    </div>
  );
}
