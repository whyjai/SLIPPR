'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { Badge, Card, PageHeader, cn } from './ui';
import NbaPlayerTrendsPanel from './NbaPlayerTrendsPanel';
import TeamTendenciesPanel from './TeamTendenciesPanel';
import type { NbaResearch } from '@/lib/research/nba-defense';
import type { NbaGameCard, PlayerLine, StyleStat, TeamLine } from '@/lib/research/nba-matchups';

type Pos = 'G' | 'F' | 'C';
const POS_LABEL: Record<Pos, string> = { G: 'Guards', F: 'Forwards', C: 'Centers' };
const label = (season: number) => `${season - 1}-${String(season).slice(2)}`;

const tipoffLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }) + ' ET';
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

export default function NbaResearchView({ sportSwitch }: { sportSwitch: ReactNode }) {
  const [season, setSeason] = useState<number | null>(null); // null = latest, resolved by the API
  const [result, setResult] = useState<{ key: number | null; data?: NbaResearch; error?: string } | null>(null);
  const [view, setView] = useState<'matchups' | 'players' | 'teams'>('matchups');
  const [pos, setPos] = useState<Pos>('G');
  const [metric, setMetric] = useState<StyleStat>('pts');
  const [softFirst, setSoftFirst] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/nba${season ? `?season=${season}` : ''}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setResult({ key: season, data: json as NbaResearch });
      })
      .catch((e) => !cancelled && setResult({ key: season, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [season]);

  const loading = result?.key !== season;
  const data = result?.data ?? null;
  const error = loading ? null : (result?.error ?? null);
  const latest = data?.latestSeason ?? null;
  const shown = data?.season ?? null;

  const table = useMemo(() => {
    if (!data) return [];
    return [...data.defense].sort(
      (a, b) => (softFirst ? 1 : -1) * (a.stats[pos][metric].rank - b.stats[pos][metric].rank),
    );
  }, [data, pos, metric, softFirst]);

  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Research"
          title="NBA Matchup Research"
          description="Team pace and efficiency, how each defense plays, defense vs position and player trends, from box scores. No odds, no picks."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {sportSwitch}
              {latest != null && (
                <div className="flex gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
                  {[latest, latest - 1].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSeason(s === latest ? null : s)}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                        shown === s ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-400 hover:text-zinc-200',
                      )}
                    >
                      {label(s)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
        />

        {data && (
          <div className="animate-fade-up mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
            <Badge tone="zinc">ESPN box scores</Badge>
            <span>
              {data.seasonLabel} regular season · {data.gamesPlayed} games per team
            </span>
          </div>
        )}

        <div className="mb-6 flex gap-1 border-b border-white/[0.06]">
          {(
            [
              ['matchups', 'Matchups'],
              ['players', 'Player trends'],
              ['teams', 'Team tendencies'],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={cn(
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition',
                view === key
                  ? 'border-emerald-400 text-emerald-300'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200',
              )}
            >
              {text}
            </button>
          ))}
        </div>

        {view === 'players' && shown != null ? (
          <NbaPlayerTrendsPanel season={shown} />
        ) : view === 'teams' && shown != null ? (
          <TeamTendenciesPanel
            season={shown}
            endpoint="/api/research/nba/teams"
            defaultMetric={{ defense: 'drtg', offense: 'pace' }}
            intro={() => (
              <>
                Pace, efficiency and shot profile on both ends, per 100 possessions where it matters. These hold up: a
                team&apos;s first 20 games predicted the rest of 2025-26 at r 0.6-0.8.
              </>
            )}
          />
        ) : loading && !data ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-28" />
            ))}
          </div>
        ) : error ? (
          <Card className="p-10 text-center text-sm text-zinc-400">Couldn&apos;t load NBA data: {error}</Card>
        ) : data ? (
          <>
            {data.slate && data.slate.games.length > 0 && (
              <section className="mb-10">
                <h2 className="mb-1 text-lg font-semibold">Next slate: {dayLabel(data.slate.date)}</h2>
                <p className="mb-4 text-sm text-zinc-500">
                  {data.slate.usingLastSeason && (
                    <span className="text-amber-400/90">
                      Using {data.slate.basisLabel} numbers until every team has 15 games this season; players are from
                      current rosters.{' '}
                    </span>
                  )}
                  Estimate = both teams&apos; pace and ratings plus a {data.slate.homeEdge}-point home edge; tested on
                  past seasons it typically misses the total by ~15 and the margin by ~12. Matchup adj. is how much this
                  opponent&apos;s style moves a player&apos;s line, and it is small: 1-5% on average.
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {data.slate.games.map((g) => (
                    <GameCard key={g.id} game={g} />
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-1 text-lg font-semibold">Defense vs. position</h2>
              <p className="mb-4 text-sm text-zinc-500">
                Per game allowed to opposing {POS_LABEL[pos].toLowerCase()} (ESPN positions). #1 allows the most.
                {data.noisy[pos] && (
                  <span className="text-amber-400/90">
                    {' '}
                    Noisy: forward and center labels are loose and matchups switch, so in 2025-26 these ranks barely
                    predicted the rest of the season. Guards held up modestly.
                  </span>
                )}
              </p>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {(['G', 'F', 'C'] as Pos[]).map((p) => (
                  <Chip key={p} text={POS_LABEL[p]} active={pos === p} onClick={() => setPos(p)} />
                ))}
                <span className="mx-1 hidden h-4 w-px bg-white/10 sm:block" />
                {data.metrics.map((m) => (
                  <Chip key={m.key} text={m.label} active={metric === m.key} onClick={() => setMetric(m.key)} />
                ))}
              </div>
              <Card className="overflow-hidden">
                <div className="grid grid-cols-[3.5rem_1fr_5.5rem_5.5rem_3.5rem] items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  <button
                    onClick={() => setSoftFirst(!softFirst)}
                    className="flex items-center gap-1 hover:text-zinc-300"
                  >
                    Rank <ArrowDownUp className="h-3 w-3" />
                  </button>
                  <span>Defense</span>
                  <span className="text-right">Per game</span>
                  <span className="text-right">vs avg</span>
                  <span className="text-right">GP</span>
                </div>
                {table.map((d) => {
                  const cell = d.stats[pos][metric];
                  const diff = cell.perGame - data.leagueAvg[pos][metric];
                  const n = data.defense.length;
                  const tone =
                    cell.rank <= 5 ? 'text-emerald-300' : cell.rank > n - 5 ? 'text-rose-300' : 'text-zinc-300';
                  return (
                    <div
                      key={d.team}
                      className="grid grid-cols-[3.5rem_1fr_5.5rem_5.5rem_3.5rem] items-center gap-2 border-b border-white/[0.04] px-4 py-2.5 text-sm last:border-0"
                    >
                      <span className={cn('font-mono font-semibold', tone)}>#{cell.rank}</span>
                      <span className="truncate text-zinc-200">{d.name}</span>
                      <span className="text-right font-mono text-zinc-200">{cell.perGame}</span>
                      <span className="text-right font-mono text-xs text-zinc-500">
                        {diff > 0 ? '+' : ''}
                        {Math.round(diff * 10) / 10}
                      </span>
                      <span className="text-right font-mono text-xs text-zinc-500">{d.games}</span>
                    </div>
                  );
                })}
                <div className="px-4 py-2.5 text-xs text-zinc-500">
                  League average: {data.leagueAvg[pos][metric]} per game
                </div>
              </Card>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Chip({ text, active, onClick }: { text: string; active: boolean; onClick: () => void }) {
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
      {text}
    </button>
  );
}

function TeamRow({ t }: { t: TeamLine }) {
  const cell = (name: string, v: number, rank: number) => (
    <span className="text-right">
      <span className="block font-mono text-zinc-200">{v}</span>
      <span className="block text-[10px] text-zinc-500">
        {name} #{rank}
      </span>
    </span>
  );
  return (
    <div className="grid grid-cols-[1fr_4.5rem_4.5rem_4.5rem] items-center gap-2 text-sm">
      <span className="font-medium text-zinc-100" title={t.name}>
        {t.team}
      </span>
      {cell('pace', t.pace, t.paceRank)}
      {cell('off', t.ortg, t.ortgRank)}
      {cell('def', t.drtg, t.drtgRank)}
    </div>
  );
}

function Adj({ v }: { v: number }) {
  if (Math.abs(v) < 1) return <span className="text-zinc-600">±0%</span>;
  return <span className={v > 0 ? 'text-emerald-300/90' : 'text-rose-300/90'}>{`${v > 0 ? '+' : ''}${v}%`}</span>;
}

function Players({ team, rows }: { team: string; rows: PlayerLine[] }) {
  if (!rows.length) return null;
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
        <tr>
          <th className="py-1 pr-2 font-medium">{team}</th>
          <th className="pr-2 text-right font-medium">Min</th>
          <th className="pr-2 text-right font-medium">Pts</th>
          <th className="pr-2 text-right font-medium">Reb</th>
          <th className="pr-2 text-right font-medium">Ast</th>
          <th className="pr-2 text-right font-medium">3PM</th>
          <th className="text-right font-medium">PRA adj.</th>
        </tr>
      </thead>
      <tbody className="font-mono text-zinc-300">
        {rows.map((p) => (
          <tr key={p.id} className="border-t border-white/[0.04]">
            <td className="max-w-[9rem] truncate py-1.5 pr-2 font-sans text-zinc-200">
              {p.name} <span className="text-zinc-500">{p.pos}</span>
            </td>
            <td className="pr-2 text-right">{p.last10.min}</td>
            {(['pts', 'reb', 'ast', 'fg3m'] as const).map((k) => (
              <td key={k} className="pr-2 text-right">
                {p.season[k]}
                <span className="block text-[10px] text-zinc-600">{p.last10[k]}</span>
              </td>
            ))}
            <td className="text-right">
              <Adj v={p.adj.pra} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GameCard({ game: g }: { game: NbaGameCard }) {
  const e = g.estimate;
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">
          {g.away.team} <span className="text-zinc-500">@</span> {g.home.team}
        </h3>
        <span className="shrink-0 font-mono text-xs text-zinc-500">{tipoffLabel(g.tipoff)}</span>
      </div>
      <div className="mb-3 space-y-2">
        <TeamRow t={g.away} />
        <TeamRow t={g.home} />
      </div>
      <p className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-xs text-zinc-300">
        Estimate: {g.away.team} {e.away} · {g.home.team} {e.home} · total {e.total} · {e.pace} possessions
      </p>
      {g.notes.length > 0 && (
        <ul className="mb-3 space-y-1.5 text-sm text-zinc-300">
          {g.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-sky-400" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <Players team={g.away.team} rows={g.players.away} />
        <Players team={g.home.team} rows={g.players.home} />
        <p className="text-[10px] text-zinc-600">Per game; small figures are the last 10 games. Min is last 10.</p>
      </div>
    </Card>
  );
}
