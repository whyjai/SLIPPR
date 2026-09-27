'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge, Card, PageHeader, cn } from './ui';
import type { MatchupNote, NflResearch, Position } from '@/lib/research/nfl-defense';
import PlayerTrendsPanel from './PlayerTrendsPanel';

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];
const SEASONS = [2026, 2025];

const NICK: Record<string, string> = {
  ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals',
  CLE: 'Browns', DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers', HOU: 'Texans', IND: 'Colts',
  JAX: 'Jaguars', KC: 'Chiefs', LV: 'Raiders', LAC: 'Chargers', LA: 'Rams', MIA: 'Dolphins', MIN: 'Vikings',
  NE: 'Patriots', NO: 'Saints', NYG: 'Giants', NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SF: '49ers',
  SEA: 'Seahawks', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders',
};

/** nflverse kickoffs are "YYYY-MM-DD HH:MM" in US Eastern. */
function kickoffLabel(kickoff: string): string {
  const [d, t] = kickoff.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t ?? '00:00').split(':').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const h12 = ((hh + 11) % 12) + 1;
  return `${weekday} ${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'} ET`;
}

export default function ResearchView() {
  const [season, setSeason] = useState(SEASONS[0]);
  const [result, setResult] = useState<{ season: number; data?: NflResearch; error?: string } | null>(null);
  const [pos, setPos] = useState<Position>('TE');
  const [metric, setMetric] = useState('receptions');
  const [softFirst, setSoftFirst] = useState(true);
  const [view, setView] = useState<'matchups' | 'players'>('matchups');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/nfl?season=${season}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setResult({ season, data: json as NflResearch });
      })
      .catch((e) => !cancelled && setResult({ season, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [season]);

  // Show the previous season's data while the new one loads, rather than flashing a skeleton.
  const loading = result?.season !== season;
  const data = result?.data ?? null;
  const error = loading ? null : (result?.error ?? null);

  // Keep the metric valid when switching positions.
  const metrics = data?.metrics[pos] ?? [];
  const activeMetric = metrics.find((m) => m.key === metric) ?? metrics[0];

  const table = useMemo(() => {
    if (!data || !activeMetric) return [];
    return [...data.defense].sort((a, b) => {
      const d = a.stats[pos][activeMetric.key].rank - b.stats[pos][activeMetric.key].rank;
      return softFirst ? d : -d;
    });
  }, [data, pos, activeMetric, softFirst]);

  const games = data ? Math.min(...data.defense.map((d) => d.games)) : 0;
  const smallSample = games > 0 && games < 4;

  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Research"
          title="NFL Matchup Research"
          description="Defense-vs-position rankings, matchup notes and player usage trends, built only from box scores and snap counts. No odds, no picks — the numbers behind the matchups."
          actions={
            <div className="flex gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSeason(s)}
                  className={cn(
                    'rounded-lg px-3.5 py-1.5 text-sm font-medium transition',
                    season === s ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          }
        />

        {data && (
          <div className="animate-fade-up mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
            <Badge tone="zinc">nflverse box scores</Badge>
            <span>
              {data.season} regular season
              {data.completedWeek > 0 && ` through Week ${data.completedWeek}`}
              {data.partialGames > 0 &&
                ` (+${data.partialGames} Week ${data.completedWeek + 1} game${data.partialGames > 1 ? 's' : ''})`}{' '}
              · {games}+ games per defense
            </span>
            {smallSample && (
              <span className="text-amber-400/90">Early season: with {games} games played, rankings can swing a lot week to week.</span>
            )}
          </div>
        )}

        <div className="mb-6 flex gap-1 border-b border-white/[0.06]">
          {(
            [
              ['matchups', 'Matchups'],
              ['players', 'Player trends'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={cn(
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition',
                view === key ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-zinc-400 hover:text-zinc-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'players' ? (
          <PlayerTrendsPanel season={season} />
        ) : loading && !data ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-28" />
            ))}
          </div>
        ) : error ? (
          <Card className="p-10 text-center text-sm text-zinc-400">Couldn&apos;t load research data: {error}</Card>
        ) : data ? (
          <>
            {data.upcomingWeek != null && data.matchups.length > 0 && (
              <section className="mb-10">
                <h2 className="mb-1 text-lg font-semibold">Week {data.upcomingWeek} matchup notes</h2>
                <p className="mb-4 text-sm text-zinc-500">
                  The most extreme defense-vs-position matchups in each game: top 3 or bottom 3 in the league.
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {data.matchups.map((g) => (
                    <Card key={g.gameId} className="p-5">
                      <div className="mb-3 flex items-baseline justify-between gap-3">
                        <h3 className="font-semibold">
                          {NICK[g.away] ?? g.away} <span className="text-zinc-500">@</span> {NICK[g.home] ?? g.home}
                        </h3>
                        <span className="shrink-0 font-mono text-xs text-zinc-500">{kickoffLabel(g.kickoff)}</span>
                      </div>
                      {g.notes.length === 0 ? (
                        <p className="text-sm text-zinc-600">No top-3 or bottom-3 matchups in this game.</p>
                      ) : (
                        <ul className="space-y-2.5">
                          {g.notes.map((n) => (
                            <NoteRow key={`${n.defense}-${n.position}-${n.metric}`} note={n} />
                          ))}
                        </ul>
                      )}
                    </Card>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-1 text-lg font-semibold">Defense vs. position</h2>
              <p className="mb-4 text-sm text-zinc-500">
                Per game allowed to opposing {pos}s. #1 allows the most (softest matchup), #{data.defense.length} the
                fewest.
              </p>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {POSITIONS.map((p) => (
                  <Chip key={p} label={p} active={pos === p} onClick={() => setPos(p)} />
                ))}
                <span className="mx-1 hidden h-4 w-px bg-white/10 sm:block" />
                {metrics.map((m) => (
                  <Chip key={m.key} label={m.label} active={activeMetric?.key === m.key} onClick={() => setMetric(m.key)} />
                ))}
              </div>
              {activeMetric && (
                <Card className="overflow-hidden">
                  <div className="grid grid-cols-[3.5rem_1fr_5.5rem_6rem_3.5rem] items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    <button onClick={() => setSoftFirst(!softFirst)} className="flex items-center gap-1 hover:text-zinc-300">
                      Rank <ArrowDownUp className="h-3 w-3" />
                    </button>
                    <span>Defense</span>
                    <span className="text-right">Per game</span>
                    <span className="text-right">vs avg</span>
                    <span className="text-right">GP</span>
                  </div>
                  {table.map((d) => {
                    const cell = d.stats[pos][activeMetric.key];
                    const avg = data.leagueAvg[pos][activeMetric.key];
                    const diff = cell.perGame - avg;
                    const n = data.defense.length;
                    const tone = cell.rank <= 5 ? 'text-emerald-300' : cell.rank > n - 5 ? 'text-rose-300' : 'text-zinc-300';
                    return (
                      <div
                        key={d.team}
                        className="grid grid-cols-[3.5rem_1fr_5.5rem_6rem_3.5rem] items-center gap-2 border-b border-white/[0.04] px-4 py-2.5 text-sm last:border-0"
                      >
                        <span className={cn('font-mono font-semibold', tone)}>#{cell.rank}</span>
                        <span className="truncate text-zinc-200">{d.name}</span>
                        <span className="text-right font-mono text-zinc-200">{cell.perGame}</span>
                        <span className={cn('text-right font-mono text-xs', diff > 0 ? 'text-emerald-400/80' : 'text-rose-400/80')}>
                          {diff > 0 ? '+' : ''}
                          {Math.round(diff * 10) / 10}
                        </span>
                        <span className="text-right font-mono text-xs text-zinc-500">{d.games}</span>
                      </div>
                    );
                  })}
                  <div className="px-4 py-2.5 text-xs text-zinc-500">
                    League average: {data.leagueAvg[pos][activeMetric.key]} {activeMetric.short} per game to {pos}s
                  </div>
                </Card>
              )}
            </section>

            <p className="mt-8 text-[11px] leading-relaxed text-zinc-600">
              Data: nflverse weekly player stats (regular season). Position groups by roster position; fullbacks count as
              RBs. Updated after each game day.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function NoteRow({ note }: { note: MatchupNote }) {
  const soft = note.direction === 'most';
  const Icon = soft ? ShieldAlert : ShieldCheck;
  return (
    <li className="flex gap-3">
      <div
        className={cn(
          'mt-0.5 flex h-6 min-w-[3.25rem] items-center justify-center gap-1 rounded-md px-1.5 font-mono text-[11px] font-semibold',
          soft ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300',
        )}
        title={soft ? 'Allows among the most in the league' : 'Allows among the fewest in the league'}
      >
        <Icon className="h-3 w-3" />#{note.rank}
      </div>
      <p className="text-sm leading-relaxed text-zinc-300">{note.text}</p>
    </li>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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
