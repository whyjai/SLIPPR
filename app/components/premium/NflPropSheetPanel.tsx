'use client';

import { useEffect, useState } from 'react';
import { Card, cn } from './ui';
import type { DefenseContext, NflPropSheet, PropGame, PropPlayer, RankedValue } from '@/lib/research/nfl-props';

/** nflverse kickoffs are "YYYY-MM-DD HH:MM" in US Eastern. */
function kickoffLabel(kickoff: string): string {
  const [d, t] = kickoff.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t ?? '00:00').split(':').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday} ${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'} ET`;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** Rank 1 = allows the most. Say it in words, softest first. */
function place(r: RankedValue, teams = 32) {
  if (!r.rank) return '';
  if (r.rank <= teams / 2) return r.rank === 1 ? 'most' : `${ordinal(r.rank)}-most`;
  const k = teams - r.rank + 1;
  return k === 1 ? 'fewest' : `${ordinal(k)}-fewest`;
}

function tone(r: RankedValue, teams = 32) {
  return r.rank && r.rank <= 6 ? 'text-emerald-300' : r.rank && r.rank > teams - 6 ? 'text-rose-300' : 'text-zinc-300';
}

function Stat({ label, r, unit = '', digits = 1 }: { label: string; r: RankedValue; unit?: string; digits?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className={cn('font-mono', tone(r))}>
        {r.value.toFixed(digits)}
        {unit} <span className="text-zinc-600">({place(r)})</span>
      </span>
    </div>
  );
}

function DefenseBox({ d, offense }: { d: DefenseContext; offense: string }) {
  return (
    <div className="grid gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 sm:grid-cols-2">
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          {d.team} run defense <span className="normal-case tracking-normal text-zinc-600">({offense} rushing)</span>
        </p>
        <div className="space-y-1">
          <Stat label="RB rush yds allowed / g" r={d.run.rbRushYds} />
          <Stat label="RB carries faced / g" r={d.run.rbCarries} />
          <Stat label="Yds / designed run" r={d.run.yardsPerRush} digits={2} />
          <Stat label="EPA / run allowed" r={d.run.epaPerRush} digits={3} />
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          {d.team} pass defense <span className="normal-case tracking-normal text-zinc-600">({offense} passing)</span>
        </p>
        <div className="space-y-1">
          <Stat label="QB pass yds allowed / g" r={d.pass.qbPassYds} />
          <Stat label="Dropbacks faced / g" r={d.pass.dropbacksFaced} />
          <Stat label="WR rec yds allowed / g" r={d.pass.wrRecYds} />
          <Stat label="TE rec yds allowed / g" r={d.pass.teRecYds} />
          <Stat label="RB rec yds allowed / g" r={d.pass.rbRecYds} />
          <Stat label="Yds / dropback" r={d.pass.yardsPerDropback} digits={2} />
        </div>
      </div>
      {d.funnel && (
        <p className="text-xs text-amber-300/90 sm:col-span-2">
          {d.funnel === 'pass'
            ? `Pass funnel: opponents throw on ${(100 * d.passRateFaced.value).toFixed(0)}% of plays vs ${d.team} (${place(d.passRateFaced)}). RB receiving rises against defenses like this (the one matchup effect that held up).`
            : `Run funnel: opponents throw on only ${(100 * d.passRateFaced.value).toFixed(0)}% of plays vs ${d.team} (${place(d.passRateFaced)}).`}
        </p>
      )}
    </div>
  );
}

function chanceTone(c: number) {
  return c >= 60 ? 'text-emerald-300' : c <= 40 ? 'text-rose-300' : 'text-zinc-300';
}

function PlayerRows({ p }: { p: PropPlayer }) {
  return (
    <>
      {p.props.map((pr, i) => (
        <tr key={pr.stat} className={cn('border-t border-white/[0.04] align-top', i === 0 && 'border-white/[0.08]')}>
          <td className="py-1.5 pr-3">
            {i === 0 && (
              <div>
                <span className="font-sans font-medium text-zinc-100">{p.name}</span>{' '}
                <span className="text-zinc-500">{p.pos}</span>
                <div className="font-sans text-[10px] text-zinc-500">
                  {p.snapPct != null && `${p.snapPct}% snaps`}
                  {p.share != null && ` · ${p.share}% tgt share`}
                  {p.missedLast && <span className="text-amber-300"> · missed last game, check injury report</span>}
                </div>
              </div>
            )}
          </td>
          <td className="pr-3 font-sans text-zinc-400">{pr.label}</td>
          <td className="pr-3 text-right">{pr.season}</td>
          <td className="pr-3 text-right">{pr.last3}</td>
          <td className="pr-3 text-right text-zinc-100">
            {pr.median}
            {pr.adjPct !== 0 && <span className="ml-1 text-[10px] text-sky-300">{pr.adjPct > 0 ? '+' : ''}{pr.adjPct}%</span>}
          </td>
          <td className="pr-3 text-right text-zinc-500">
            {pr.low}–{pr.high}
          </td>
          <td className="text-right">
            <div className="flex flex-wrap justify-end gap-x-3">
              {pr.lines.map((l) => (
                <span key={l.line} title={`His games over ${l.line}: ${l.hits} of ${l.games}`}>
                  <span className="text-zinc-500">o{l.line}</span> <span className={chanceTone(l.chance)}>{l.chance}%</span>{' '}
                  <span className="text-[10px] text-zinc-600">
                    {l.hits}/{l.games}
                  </span>
                </span>
              ))}
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function GameSheet({ g }: { g: PropGame }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">
          {g.away} <span className="text-zinc-500">@</span> {g.home}
        </h3>
        <span className="font-mono text-xs text-zinc-500">{kickoffLabel(g.kickoff)}</span>
      </div>
      <div className="space-y-6">
        {g.sides.map((s) => (
          <div key={s.offense}>
            <p className="mb-2 text-sm font-semibold text-zinc-200">
              {s.offense} offense vs {s.defense.team} defense
            </p>
            <DefenseBox d={s.defense} offense={s.offense} />
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] font-mono text-xs text-zinc-300">
                <thead className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Player</th>
                    <th className="pr-3 font-medium">Prop</th>
                    <th className="pr-3 text-right font-medium">Avg</th>
                    <th className="pr-3 text-right font-medium">Last 3</th>
                    <th className="pr-3 text-right font-medium">Median</th>
                    <th className="pr-3 text-right font-medium">Middle 50%</th>
                    <th className="text-right font-medium">Chance over · his games over</th>
                  </tr>
                </thead>
                <tbody>
                  {s.players.map((p) => (
                    <PlayerRows key={p.id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function NflPropSheetPanel({ season }: { season: number }) {
  const [result, setResult] = useState<{ season: number; data?: NflPropSheet; error?: string } | null>(null);
  const [game, setGame] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/nfl/props?season=${season}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setResult({ season, data: json as NflPropSheet });
      })
      .catch((e) => !cancelled && setResult({ season, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [season]);

  const loading = result?.season !== season;
  const data = result?.data ?? null;
  if (loading && !data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-28" />
        ))}
      </div>
    );
  }
  if (!loading && result?.error) {
    return <Card className="p-10 text-center text-sm text-zinc-400">Couldn&apos;t build the prop sheet: {result.error}</Card>;
  }
  if (!data) return null;
  if (!data.games.length) {
    return <Card className="p-10 text-center text-sm text-zinc-400">No upcoming games on the {data.season} schedule.</Card>;
  }
  const shown = game ? data.games.filter((g) => g.gameId === game) : data.games;

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Week {data.week} prop cheat sheet</h2>
      <div className="mb-4 space-y-2 text-sm text-zinc-500">
        <p>
          Every remaining Week {data.week}{' '}game: how each defense plays the run and the pass by position, and each
          player&apos;s prop stats through Week {data.throughWeek}. <strong className="text-zinc-300">Median</strong> is
          his typical game (season average with a light weight on the last 3, which beat heavier recency in 2024 and
          2025 tests); <strong className="text-zinc-300">middle 50%</strong> is the range he lands in half the time.
        </p>
        <p>
          <strong className="text-zinc-300">Chance over</strong>{' '}comes from how far real outcomes spread around a
          player&apos;s average; checked on the 2025 season it landed within ~3 points (said 25% → 23%, 55% → 52%, 74% →
          74%). Yardage medians sit below averages: a few big games inflate the average, so lines set at the average go
          under more often than over.
        </p>
        <p className="text-amber-300/90">
          What didn&apos;t hold up: in walk-forward tests (fit 2023/2024, checked on the next season), run defense didn&apos;t
          predict RB rushing, and pass defense barely moved QB/WR/TE stats beyond the player&apos;s own numbers. They&apos;re
          shown as context. The one matchup effect that held up both years, RB receiving vs defenses that face a lot
          of passing, is applied (blue %).
        </p>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <button
          onClick={() => setGame(null)}
          className={cn(
            'rounded-full border px-3.5 py-1.5 text-xs font-medium transition',
            game == null ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/[0.08] text-zinc-400 hover:text-zinc-200',
          )}
        >
          All games
        </button>
        {data.games.map((g) => (
          <button
            key={g.gameId}
            onClick={() => setGame(g.gameId)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-xs font-medium transition',
              game === g.gameId ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/[0.08] text-zinc-400 hover:text-zinc-200',
            )}
          >
            {g.away} @ {g.home}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        {shown.map((g) => (
          <GameSheet key={g.gameId} g={g} />
        ))}
      </div>
    </section>
  );
}
