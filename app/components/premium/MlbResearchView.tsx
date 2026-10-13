'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Card, PageHeader, cn } from './ui';
import MlbPlayerTrendsPanel from './MlbPlayerTrendsPanel';
import TeamTendenciesPanel from './TeamTendenciesPanel';
import type { MlbGameCard, MlbResearch, ProbableLine } from '@/lib/research/mlb-research';

const fmt3 = (x: number | null) => (x == null ? '—' : x.toFixed(3).replace(/^0/, ''));
const startLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function MlbResearchView({ sportSwitch }: { sportSwitch: ReactNode }) {
  const [season, setSeason] = useState<number | null>(null);
  const [result, setResult] = useState<{ key: number | null; data?: MlbResearch; error?: string } | null>(null);
  const [view, setView] = useState<'matchups' | 'players' | 'teams'>('matchups');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/mlb${season ? `?season=${season}` : ''}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setResult({ key: season, data: json as MlbResearch });
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

  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Research"
          title="MLB Matchup Research"
          description="Probable starters against the lineups they face, platoon splits, park factors, and hitter and pitcher trends, from play-by-play. No odds, no picks."
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
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
        />

        {data && (
          <div className="animate-fade-up mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
            <Badge tone="zinc">MLB play-by-play</Badge>
            <span>
              {data.season} regular season · {data.gamesPlayed}+ games per team · league {fmt3(data.league.woba)} wOBA,{' '}
              {data.league.kPct}% K, {data.league.runsPerGame} runs per team-game
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
                view === key ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-zinc-400 hover:text-zinc-200',
              )}
            >
              {text}
            </button>
          ))}
        </div>

        {view === 'players' && shown != null ? (
          <MlbPlayerTrendsPanel season={shown} />
        ) : view === 'teams' && shown != null ? (
          <TeamTendenciesPanel
            season={shown}
            endpoint="/api/research/mlb/teams"
            defaultMetric={{ defense: 'wobaAllowed', offense: 'woba' }}
            sideLabels={{ defense: 'Pitching', offense: 'Hitting' }}
            intro={() => (
              <>
                Hitting (with platoon splits) and pitching for every team. What holds up from the first half of a season
                to the second: team strikeout rate vs right-handers (r ~0.7); vs left-handers and wOBA by hand only
                modestly (r 0.25-0.5).
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
          <Card className="p-10 text-center text-sm text-zinc-400">Couldn&apos;t load MLB data: {error}</Card>
        ) : data ? (
          <>
            {data.slate ? (
              <section className="mb-10">
                <h2 className="mb-1 text-lg font-semibold">Next slate: {dayLabel(data.slate.date)}</h2>
                <p className="mb-4 text-sm text-zinc-500">
                  Probable starters against the lineup they face, using this season&apos;s numbers. Expected strikeouts =
                  his batters faced per start × his strikeout rate combined with the lineup&apos;s rate against his hand.
                  Tested on 2024 and 2025 it misses by ~1.8 K per start on average; his own K rate does most of the work,
                  the lineup adds little.
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {data.slate.games.map((g) => (
                    <GameCard key={g.gamePk} g={g} />
                  ))}
                </div>
              </section>
            ) : (
              data.season === data.latestSeason && (
                <p className="mb-8 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-zinc-400">
                  No MLB games in the next two weeks. The numbers below are the {data.season} season.
                </p>
              )
            )}

            <section>
              <h2 className="mb-1 text-lg font-semibold">Park factors</h2>
              <p className="mb-4 text-sm text-zinc-500">
                Runs per game at each park (both teams) against its home team&apos;s road games, last three seasons. One
                season of this is mostly noise (r 0.22-0.27 year to year), so each season is pulled halfway to neutral
                before averaging. 1.10 = about 10% more runs than an average park.
              </p>
              <Card className="overflow-hidden">
                <div className="grid grid-cols-[3rem_1fr_4rem_5rem_4rem] items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  <span>Rank</span>
                  <span>Park</span>
                  <span>Team</span>
                  <span className="text-right">Runs</span>
                  <span className="text-right">Seasons</span>
                </div>
                {data.parks.map((p, i) => (
                  <div
                    key={p.venueId}
                    className="grid grid-cols-[3rem_1fr_4rem_5rem_4rem] items-center gap-2 border-b border-white/[0.04] px-4 py-2 text-sm last:border-0"
                  >
                    <span className="font-mono text-zinc-500">#{i + 1}</span>
                    <span className="truncate text-zinc-200">{p.venue}</span>
                    <span className="text-zinc-400">{p.team}</span>
                    <span
                      className={cn(
                        'text-right font-mono',
                        p.factor >= 1.04 ? 'text-rose-300' : p.factor <= 0.96 ? 'text-sky-300' : 'text-zinc-200',
                      )}
                    >
                      {p.factor.toFixed(2)}
                    </span>
                    <span className="text-right font-mono text-xs text-zinc-500">{p.seasons}</span>
                  </div>
                ))}
              </Card>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Probable({ side, p }: { side: string; p: ProbableLine | null }) {
  if (!p) return <p className="text-sm text-zinc-500">{side}: probable starter not announced.</p>;
  const s = p.season;
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-medium text-zinc-100">
          {p.name} <span className="text-xs text-zinc-500">{p.throws}HP · {side}</span>
        </span>
        {p.expectedK != null && (
          <span className="shrink-0 font-mono text-xs text-emerald-300">~{p.expectedK} K expected</span>
        )}
      </div>
      <p className="font-mono text-xs text-zinc-400">
        {p.starts} GS · {p.ipPerStart ?? '—'} IP/start · {s.kPct ?? '—'}% K · {s.bbPct ?? '—'}% BB · {s.fip ?? '—'} FIP ·{' '}
        {fmt3(s.wobaAllowed)} wOBA
        {p.last3K.length > 0 && ` · last 3: ${p.last3K.join(', ')} K`}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        {p.opp.team} vs {p.throws}HP: {p.opp.kPct ?? '—'}% K (#{p.opp.kRank} most), {fmt3(p.opp.woba)} wOBA (#{p.opp.wobaRank})
      </p>
    </div>
  );
}

function GameCard({ g }: { g: MlbGameCard }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">
          {g.away.team} <span className="text-zinc-500">@</span> {g.home.team}
          {g.postseason && <span className="ml-2 text-xs font-normal text-amber-300">postseason</span>}
        </h3>
        <span className="shrink-0 font-mono text-xs text-zinc-500">{startLabel(g.start)}</span>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        {g.venue}
        {g.park != null && ` · park runs ${g.park.toFixed(2)}`}
      </p>
      <div className="space-y-2">
        <Probable side={g.away.team} p={g.away.probable} />
        <Probable side={g.home.team} p={g.home.probable} />
      </div>
    </Card>
  );
}
