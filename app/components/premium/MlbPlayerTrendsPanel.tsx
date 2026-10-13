'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { Card, cn } from './ui';
import type { MlbHitter, MlbPitcher, MlbPlayerTrends } from '@/lib/research/mlb-research';

type Kind = 'hitters' | 'pitchers';
const PAGE = 40;

const fmt3 = (x: number | null) => (x == null ? '—' : x.toFixed(3).replace(/^0/, ''));
const fmtPct = (x: number | null) => (x == null ? '—' : `${x}%`);

/** "a/b last n" for a threshold on a log. */
function HitRate<T>({ label, log, hit }: { label: string; log: T[]; hit: (g: T) => boolean }) {
  const last5 = log.slice(0, 5);
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <p className="text-xs font-medium text-zinc-200">{label}</p>
      <p className="font-mono text-[11px] text-zinc-500">
        {last5.filter(hit).length}/{last5.length} last {last5.length} · {log.filter(hit).length}/{log.length} last {log.length}
      </p>
    </div>
  );
}

export default function MlbPlayerTrendsPanel({ season }: { season: number }) {
  const [result, setResult] = useState<{ season: number; data?: MlbPlayerTrends; error?: string } | null>(null);
  const [kind, setKind] = useState<Kind>('hitters');
  const [team, setTeam] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/mlb/players?season=${season}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setResult({ season, data: json as MlbPlayerTrends });
      })
      .catch((e) => !cancelled && setResult({ season, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [season]);

  const loading = result?.season !== season;
  const data = result?.data ?? null;
  const teams = useMemo(() => (data ? [...new Set(data.hitters.map((p) => p.team))].sort() : []), [data]);
  const { hitters, pitchers } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: { team: string; name: string }) => (!team || p.team === team) && (!q || p.name.toLowerCase().includes(q));
    return { hitters: data ? data.hitters.filter(match) : [], pitchers: data ? data.pitchers.filter(match) : [] };
  }, [data, team, query]);

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
  const rows = kind === 'hitters' ? hitters : pitchers;

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Player trends</h2>
      <p className="mb-4 text-sm text-zinc-500">
        {data.seasonLabel} regular season. Hitters with 150+ plate appearances, pitchers with 120+ batters faced. Open a
        row for the last 10 games, platoon splits and hit rates.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
          {(['hitters', 'pitchers'] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setLimit(PAGE);
                setOpen(null);
              }}
              className={cn(
                'rounded-lg px-3.5 py-1.5 text-sm font-medium capitalize transition',
                kind === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              {k}
            </button>
          ))}
        </div>
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
      </div>

      <Card className="overflow-x-auto">
        <div className="min-w-[680px]">
          {kind === 'hitters' ? (
            <>
              <Header cols={['Player', 'PA', 'AVG', 'OBP', 'SLG', 'wOBA', 'HR', 'K%', 'BB%']} />
              {hitters.slice(0, limit).map((p) => (
                <Fragment key={p.id}>
                  <Row
                    open={open === p.id}
                    onClick={() => setOpen(open === p.id ? null : p.id)}
                    name={p.name}
                    sub={`${p.pos} · ${p.team} · bats ${p.bats}`}
                    cells={[p.season.pa, fmt3(p.season.avg), fmt3(p.season.obp), fmt3(p.season.slg), fmt3(p.season.woba), p.season.hr, fmtPct(p.season.kPct), fmtPct(p.season.bbPct)]}
                  />
                  {open === p.id && <HitterDetail p={p} />}
                </Fragment>
              ))}
            </>
          ) : (
            <>
              <Header cols={['Pitcher', 'GS', 'IP', 'K%', 'BB%', 'K-BB%', 'HR/9', 'FIP', 'wOBA']} />
              {pitchers.slice(0, limit).map((p) => (
                <Fragment key={p.id}>
                  <Row
                    open={open === p.id}
                    onClick={() => setOpen(open === p.id ? null : p.id)}
                    name={p.name}
                    sub={`${p.throws}HP · ${p.team} · ${p.appearances} G`}
                    cells={[p.starts, p.season.ip, fmtPct(p.season.kPct), fmtPct(p.season.bbPct), fmtPct(p.season.kbb), p.season.hr9 ?? '—', p.season.fip ?? '—', fmt3(p.season.wobaAllowed)]}
                  />
                  {open === p.id && <PitcherDetail p={p} />}
                </Fragment>
              ))}
            </>
          )}
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
  );
}

const GRID = 'grid grid-cols-[minmax(10rem,1.8fr)_repeat(8,minmax(3.2rem,1fr))_1.5rem] items-center gap-2';

function Header({ cols }: { cols: string[] }) {
  return (
    <div className={cn(GRID, 'border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500')}>
      {cols.map((c, i) => (
        <span key={c} className={i ? 'text-right' : ''}>
          {c}
        </span>
      ))}
      <span />
    </div>
  );
}

function Row({ name, sub, cells, open, onClick }: { name: string; sub: string; cells: Array<string | number>; open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn(GRID, 'w-full border-b border-white/[0.04] px-4 py-2.5 text-left text-sm hover:bg-white/[0.02]')}>
      <span className="min-w-0">
        <span className="block truncate font-medium text-zinc-100">{name}</span>
        <span className="text-xs text-zinc-500">{sub}</span>
      </span>
      {cells.map((c, i) => (
        <span key={i} className="text-right font-mono text-zinc-200">
          {c}
        </span>
      ))}
      {open ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
    </button>
  );
}

function Platoon({ label, l }: { label: string; l: { pa: number; ops: number | null; woba: number | null; kPct: number | null } }) {
  return (
    <span className={cn('rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 font-mono text-xs', l.pa < 100 ? 'text-zinc-600' : 'text-zinc-300')}>
      {label}: {fmt3(l.woba)} wOBA · {fmt3(l.ops)} OPS · {fmtPct(l.kPct)} K · {l.pa} PA
    </span>
  );
}

function HitterDetail({ p }: { p: MlbHitter }) {
  return (
    <div className="border-b border-white/[0.06] bg-black/30 px-4 py-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <Platoon label="vs LHP" l={p.vsL} />
        <Platoon label="vs RHP" l={p.vsR} />
        <span className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 font-mono text-xs text-zinc-300">
          last 15 games: {fmt3(p.last15.woba)} wOBA · {fmt3(p.last15.ops)} OPS · {p.last15.hr} HR
        </span>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <HitRate label="1+ hit" log={p.log} hit={(g) => g.h >= 1} />
        <HitRate label="2+ hits" log={p.log} hit={(g) => g.h >= 2} />
        <HitRate label="2+ total bases" log={p.log} hit={(g) => g.tb >= 2} />
        <HitRate label="Home run" log={p.log} hit={(g) => g.hr >= 1} />
        <HitRate label="1+ RBI" log={p.log} hit={(g) => g.rbi >= 1} />
      </div>
      <LogTable
        head={['Date', 'Opp', 'SP', 'PA', 'H', 'TB', 'HR', 'RBI', 'BB', 'K']}
        rows={p.log.map((g) => [g.date.slice(5), g.opp, g.oppHand ? `${g.oppHand}HP` : '—', g.pa, g.h, g.tb, g.hr, g.rbi, g.bb, g.k])}
      />
    </div>
  );
}

function PitcherDetail({ p }: { p: MlbPitcher }) {
  const starts = p.log.filter((g) => g.started);
  return (
    <div className="border-b border-white/[0.06] bg-black/30 px-4 py-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <Platoon label="vs LHB" l={p.vsL} />
        <Platoon label="vs RHB" l={p.vsR} />
        {p.ipPerStart != null && (
          <span className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 font-mono text-xs text-zinc-300">
            {p.ipPerStart} IP · {p.bfPerStart} batters per start
          </span>
        )}
      </div>
      {starts.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[4, 5, 6, 7].map((k) => (
            <HitRate key={k} label={`${k}+ strikeouts (starts)`} log={starts} hit={(g) => g.k >= k} />
          ))}
        </div>
      )}
      <LogTable
        head={['Date', 'Opp', 'Role', 'IP', 'BF', 'K', 'BB', 'H', 'HR', 'R']}
        rows={p.log.map((g) => [g.date.slice(5), g.opp, g.started ? 'SP' : 'RP', g.ip, g.bf, g.k, g.bb, g.h, g.hr, g.r])}
      />
    </div>
  );
}

function LogTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cn('py-1.5 pr-3 font-medium', i > 2 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono text-zinc-300">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/[0.04]">
              {r.map((c, j) => (
                <td key={j} className={cn('py-1.5 pr-3', j === 0 && 'text-zinc-500', j > 2 && 'text-right')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
