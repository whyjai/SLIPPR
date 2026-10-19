/**
 * Calibrate basketball prop baselines and outcome spreads on history.
 * Walk-forward: each player-game uses only that player's earlier games this
 * season (plus, early on, last season's average). Picks the baseline recipe on
 * the fit seasons, builds outcome spreads, and tests on the held-out season,
 * including the first 5 games of a season.
 *
 *   npx tsx scripts/research/calibrate-hoops-props.mts nba     (fit 2022-25, test 2026)
 *   npx tsx scripts/research/calibrate-hoops-props.mts wnba    (fit 2022-25, test 2026)
 *
 * Writes data/research/{league}-prop-spread.json (fit + test seasons pooled).
 */
import { writeFileSync } from 'node:fs';
import { isLeague, playerGames, type HoopsPlayerGame, type League } from '../../lib/research/hoops-data';
import { blendBaseline, buildSpread, scoreSpread, type BaselineParams } from '../../lib/research/props-engine';
import { HOOPS_MIN_BASE, HOOPS_STATS, hoopsStat, type HoopsStat } from '../../lib/research/hoops-props';

const arg = process.argv[2] ?? 'nba';
if (!isLeague(arg)) throw new Error('usage: calibrate-hoops-props.mts <nba|wnba>');
const league: League = arg;
const FIT = [2022, 2023, 2024, 2025];
const TEST = [2026];
/** Games 1-N of a season use the early-season spread. */
const EARLY_GAMES = 10;

type Sample = { season: number; game: number; stat: HoopsStat; values: number[]; prior: number | null; actual: number };

const load = new Map<number, HoopsPlayerGame[]>();
for (const s of [FIT[0] - 1, ...FIT, ...TEST]) load.set(s, await playerGames(league, s).catch(() => []));

function priorAverages(season: number): Map<string, Record<HoopsStat, number>> {
  const prev = load.get(season - 1) ?? [];
  const by = new Map<string, HoopsPlayerGame[]>();
  for (const g of prev) by.set(g.playerId, [...(by.get(g.playerId) ?? []), g]);
  const out = new Map<string, Record<HoopsStat, number>>();
  for (const [id, gs] of by) {
    if (gs.length < 10) continue;
    out.set(id, Object.fromEntries(HOOPS_STATS.map((st) => [st, gs.reduce((a, g) => a + hoopsStat(g, st), 0) / gs.length])) as Record<HoopsStat, number>);
  }
  return out;
}

function samplesFor(season: number): Sample[] {
  const prior = priorAverages(season);
  const by = new Map<string, HoopsPlayerGame[]>();
  for (const g of load.get(season) ?? []) by.set(g.playerId, [...(by.get(g.playerId) ?? []), g]);
  const out: Sample[] = [];
  for (const [id, gs] of by) {
    gs.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < gs.length; i++) {
      for (const stat of HOOPS_STATS) {
        out.push({ season, game: i + 1, stat, values: gs.slice(0, i).map((g) => hoopsStat(g, stat)), prior: prior.get(id)?.[stat] ?? null, actual: hoopsStat(gs[i], stat) });
      }
    }
  }
  return out;
}

const fitSamples = FIT.flatMap(samplesFor);
const testSamples = TEST.flatMap(samplesFor);
console.log(`${league.toUpperCase()}: fit ${FIT.join(',')} ${fitSamples.length} · test ${TEST.join(',')} ${testSamples.length} player-game-stats\n`);

const eligible = (base: number | null, stat: HoopsStat): base is number => base != null && base >= HOOPS_MIN_BASE[league][stat];
const withBase = (ss: Sample[], p: BaselineParams) =>
  ss.flatMap((s) => {
    const base = blendBaseline(s.values, s.prior, p);
    // Early-season games get their own spread: last season's average overstates players early on.
    return eligible(base, s.stat) ? [{ key: `${s.game <= EARLY_GAMES ? 'early|' : ''}${s.stat}`, base, actual: s.actual, game: s.game, stat: s.stat }] : [];
  });

// 1. Baseline recipe: mean absolute error per stat, relative to the no-prior / no-recency recipe.
console.log('1. Baseline recipes on the fit seasons (relative error; lower is better; same eligible player-games)');
const grid: BaselineParams[] = [];
for (const recentWeight of [0, 0.25, 0.5]) for (const recentN of [5, 10]) for (const priorGames of [0, 3, 6, 10, 20]) grid.push({ recentWeight, recentN, priorGames, minGames: 3 });
// Score every recipe on the same player-games: those where the plainest recipe has a baseline.
const ref: BaselineParams = { recentWeight: 0, recentN: 5, priorGames: 0, minGames: 3 };
const refIdx = fitSamples.map((s, i) => (eligible(blendBaseline(s.values, s.prior, ref), s.stat) ? i : -1)).filter((i) => i >= 0);
const mae = (p: BaselineParams, idx: number[], ss: Sample[]) => {
  const per = new Map<HoopsStat, { e: number; n: number }>();
  for (const i of idx) {
    const s = ss[i];
    const b = blendBaseline(s.values, s.prior, p) ?? 0;
    const x = per.get(s.stat) ?? { e: 0, n: 0 };
    x.e += Math.abs(s.actual - b);
    x.n++;
    per.set(s.stat, x);
  }
  return per;
};
const refErr = mae(ref, refIdx, fitSamples);
let best = ref;
let bestScore = Infinity;
for (const p of grid) {
  const err = mae(p, refIdx, fitSamples);
  const score = HOOPS_STATS.reduce((a, st) => a + err.get(st)!.e / err.get(st)!.n / (refErr.get(st)!.e / refErr.get(st)!.n), 0) / HOOPS_STATS.length;
  if (score < bestScore) {
    bestScore = score;
    best = p;
  }
}
console.log(`   best: last ${best.recentN} games at ${best.recentWeight} weight, last season worth ${best.priorGames} games → error ${(100 * (bestScore - 1)).toFixed(1)}% vs plain season average`);

// Early season: games 1-5 can only be covered with a prior.
const early = (ss: Sample[], p: BaselineParams) => withBase(ss.filter((s) => s.game <= 5), p);
console.log(`   coverage, games 1-5 of a season: ${early(fitSamples, best).length} player-game-stats with a baseline (plain recipe: ${early(fitSamples, ref).length})`);

// 2. Spread: build on fit, score on test.
const fitB = withBase(fitSamples, best);
const testB = withBase(testSamples, best);
const model = buildSpread(fitB);
const all = scoreSpread(model, testB);
const earlyScore = scoreSpread(model, testB.filter((s) => s.game <= 5));
console.log(`\n2. Outcome spread, fit ${FIT.join(',')} → test ${TEST.join(',')}`);
console.log(`   all games:   Brier ${all.brier.toFixed(4)} · over median ${(100 * all.overMedian).toFixed(1)}% · inside middle 50% ${(100 * all.insideMiddle50).toFixed(1)}% · said→happened ${all.bins}  (n=${testB.length})`);
console.log(`   games 1-5:   Brier ${earlyScore.brier.toFixed(4)} · over median ${(100 * earlyScore.overMedian).toFixed(1)}% · inside middle 50% ${(100 * earlyScore.insideMiddle50).toFixed(1)}% · said→happened ${earlyScore.bins}`);
for (const stat of HOOPS_STATS) {
  const sc = scoreSpread(model, testB.filter((s) => s.stat === stat));
  console.log(`   ${stat.padEnd(5)} Brier ${sc.brier.toFixed(4)} · over median ${(100 * sc.overMedian).toFixed(1)}% · middle 50% ${(100 * sc.insideMiddle50).toFixed(1)}% · ${sc.bins}`);
}

// 3. Production: every season.
const prod = buildSpread([...fitB, ...testB]);
writeFileSync(
  `data/research/${league}-prop-spread.json`,
  JSON.stringify({ league, fitSeasons: [...FIT, ...TEST], baseline: best, earlyGames: EARLY_GAMES, test: { brier: all.brier, overMedian: all.overMedian, insideMiddle50: all.insideMiddle50, bins: all.bins, early: earlyScore.bins }, ...prod }),
);
console.log(`\nwrote data/research/${league}-prop-spread.json`);
