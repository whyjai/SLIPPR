/**
 * Calibrate basketball prop baselines and outcome spreads on history.
 * Walk-forward: each player-game uses only that player's earlier games this
 * season (plus, early on, last season's average). Picks the baseline recipe on
 * the fit seasons, builds outcome spreads per season phase (team's opener, late
 * debut, games 2-10, team changers apart; hoopsSpreadKeys), and tests on the
 * held-out season and on the current season's games so far (not fit).
 *
 *   npx tsx scripts/research/calibrate-hoops-props.mts nba     (fit 2022-25, test 2026)
 *   npx tsx scripts/research/calibrate-hoops-props.mts wnba    (fit 2022-25, test 2026)
 *
 * Writes data/research/{league}-prop-spread.json (fit + test seasons pooled).
 */
import { writeFileSync } from 'node:fs';
import { isLeague, playerGames, seasonFor, type HoopsPlayerGame, type League } from '../../lib/research/hoops-data';
import { blendBaseline, buildSpread, scoreSpread, spreadFor, type BaselineParams, type SpreadModel } from '../../lib/research/props-engine';
import { HOOPS_MIN_BASE, HOOPS_STATS, hoopsSpreadKeys, hoopsStat, type HoopsStat } from '../../lib/research/hoops-props';

const arg = process.argv[2] ?? 'nba';
if (!isLeague(arg)) throw new Error('usage: calibrate-hoops-props.mts <nba|wnba>');
const league: League = arg;
const FIT = [2022, 2023, 2024, 2025];
const TEST = [2026];
/** Games 1-N of a season use the early-season spread. */
const EARLY_GAMES = 10;
/** A phase spread needs this many player-games, else its samples fall back to the next key (hoopsSpreadKeys). */
const MIN_KEY_SAMPLES = 300;
/** The season under way: scored as a live check, never fit. */
const LIVE = seasonFor(league);

type Sample = { season: number; game: number; stat: HoopsStat; keys: string[]; phase: string; values: number[]; prior: number | null; actual: number };

const load = new Map<number, HoopsPlayerGame[]>();
for (const s of new Set([FIT[0] - 1, ...FIT, ...TEST, LIVE - 1, LIVE])) load.set(s, await playerGames(league, s).catch(() => []));

/** Last season's averages (10+ games) and the team each player finished with. */
function priorAverages(season: number): Map<string, { avg: Record<HoopsStat, number>; team: string }> {
  const prev = load.get(season - 1) ?? [];
  const by = new Map<string, HoopsPlayerGame[]>();
  for (const g of prev) by.set(g.playerId, [...(by.get(g.playerId) ?? []), g]);
  const out = new Map<string, { avg: Record<HoopsStat, number>; team: string }>();
  for (const [id, gs] of by) {
    if (gs.length < 10) continue;
    gs.sort((a, b) => a.date.localeCompare(b.date));
    const avg = Object.fromEntries(HOOPS_STATS.map((st) => [st, gs.reduce((a, g) => a + hoopsStat(g, st), 0) / gs.length])) as Record<HoopsStat, number>;
    out.set(id, { avg, team: gs[gs.length - 1].team });
  }
  return out;
}

function samplesFor(season: number): Sample[] {
  const prior = priorAverages(season);
  const rows = load.get(season) ?? [];
  const by = new Map<string, HoopsPlayerGame[]>();
  for (const g of rows) by.set(g.playerId, [...(by.get(g.playerId) ?? []), g]);
  // Each team's game dates, to count the games it played before a date.
  const teamDates = new Map<string, Set<string>>();
  for (const g of rows) (teamDates.get(g.team) ?? teamDates.set(g.team, new Set()).get(g.team)!).add(g.date);
  const teamGamesBefore = (team: string, date: string) => [...(teamDates.get(team) ?? [])].filter((d) => d < date).length;
  const out: Sample[] = [];
  for (const [id, gs] of by) {
    gs.sort((a, b) => a.date.localeCompare(b.date));
    const pr = prior.get(id);
    for (let i = 0; i < gs.length; i++) {
      const phase = { games: i, teamGames: teamGamesBefore(gs[i].team, gs[i].date), moved: !!pr && pr.team !== gs[i].team };
      const label = i === 0 ? (phase.teamGames ? 'debut' : 'opener') : i < EARLY_GAMES ? 'games 2-10' : 'later';
      for (const stat of HOOPS_STATS) {
        out.push({
          season, game: i + 1, stat, keys: hoopsSpreadKeys(stat, phase, EARLY_GAMES), phase: `${label}${phase.moved && label !== 'later' ? ', new team' : ''}`,
          values: gs.slice(0, i).map((g) => hoopsStat(g, stat)), prior: pr?.avg[stat] ?? null, actual: hoopsStat(gs[i], stat),
        });
      }
    }
  }
  return out;
}

const fitSamples = FIT.flatMap(samplesFor);
const testSamples = TEST.flatMap(samplesFor);
const liveSamples = TEST.includes(LIVE) || FIT.includes(LIVE) ? [] : samplesFor(LIVE);
console.log(`${league.toUpperCase()}: fit ${FIT.join(',')} ${fitSamples.length} · test ${TEST.join(',')} ${testSamples.length} · live ${LIVE} ${liveSamples.length} player-game-stats\n`);

const eligible = (base: number | null, stat: HoopsStat): base is number => base != null && base >= HOOPS_MIN_BASE[league][stat];
const withBase = (ss: Sample[], p: BaselineParams) =>
  ss.flatMap((s) => {
    const base = blendBaseline(s.values, s.prior, p);
    return eligible(base, s.stat) ? [{ keys: s.keys, key: s.stat as string, phase: s.phase, base, actual: s.actual, game: s.game, stat: s.stat }] : [];
  });
type Based = ReturnType<typeof withBase>[number];
/**
 * Each sample's spread: the most specific key with enough fit samples. A key's
 * count is every sample that could use it, so a thin phase pools with its parent.
 */
function assignKeys(fit: Based[], ...others: Based[][]) {
  const n = new Map<string, number>();
  for (const s of fit) for (const k of s.keys) n.set(k, (n.get(k) ?? 0) + 1);
  for (const s of [...fit, ...others.flat()]) s.key = s.keys.find((k) => (n.get(k) ?? 0) >= MIN_KEY_SAMPLES) ?? s.stat;
}
/** Fewest player-games (all stats) for a thin phase to get a scaled copy of its parent's spread. */
const MIN_SCALED_SAMPLES = 100;
/**
 * A phase too thin for its own spreads (a team changer's opener, a late debut)
 * borrows the next key's, scaled so its median fits: the median, all stats
 * pooled, of actual / (baseline × the borrowed spread's median ratio).
 */
function addScaled(model: SpreadModel, ss: Based[]) {
  const family = (k: string) => k.slice(0, k.lastIndexOf('|') + 1);
  const rel = new Map<string, number[]>();
  for (const s of ss) {
    const k = s.keys[0];
    const qs = spreadFor(model, s.key, s.base);
    if (model.cuts[k] || !qs || !qs[10]) continue;
    (rel.get(family(k)) ?? rel.set(family(k), []).get(family(k))!).push(s.actual / (s.base * qs[10]));
  }
  const scaled: string[] = [];
  for (const s of ss) {
    const k = s.keys[0];
    const r = rel.get(family(k));
    if (model.cuts[k] || !r || r.length < MIN_SCALED_SAMPLES) continue;
    const sorted = [...r].sort((a, b) => a - b);
    const m = sorted[Math.floor(sorted.length / 2)];
    model.cuts[k] = model.cuts[s.key];
    for (const t of [0, 1, 2]) if (model.tables[`${s.key}|${t}`]) model.tables[`${k}|${t}`] = model.tables[`${s.key}|${t}`].map((q) => Math.round(q * m * 1000) / 1000);
    scaled.push(`${k} = ${s.key} ×${m.toFixed(3)}`);
  }
  return scaled;
}
const PHASES = ['opener', 'opener, new team', 'debut', 'debut, new team', 'games 2-10', 'games 2-10, new team', 'later'];

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

// 2. Spread: build on fit, score on test (and on the live season so far).
const fitB = withBase(fitSamples, best);
const testB = withBase(testSamples, best);
const liveB = withBase(liveSamples, best);
assignKeys(fitB, testB, liveB);
const model = buildSpread(fitB);
addScaled(model, fitB);
// Score each sample on the most specific spread the model has, as the sheet does.
for (const s of [...fitB, ...testB, ...liveB]) s.key = s.keys.find((k) => model.cuts[k]) ?? s.stat;
const line = (label: string, ss: Based[]) => {
  if (!ss.length) return;
  const sc = scoreSpread(model, ss);
  console.log(`   ${label.padEnd(22)} Brier ${sc.brier.toFixed(4)} · over median ${(100 * sc.overMedian).toFixed(1)}% · middle 50% ${(100 * sc.insideMiddle50).toFixed(1)}% · said→happened ${sc.bins}  (n=${ss.length})`);
};
const all = scoreSpread(model, testB);
const earlyScore = scoreSpread(model, testB.filter((s) => s.game <= 5));
console.log(`\n2. Outcome spread, fit ${FIT.join(',')} → test ${TEST.join(',')}`);
line('all games', testB);
line('games 1-5', testB.filter((s) => s.game <= 5));
for (const ph of PHASES) line(ph, testB.filter((s) => s.phase === ph));
for (const stat of HOOPS_STATS) line(stat, testB.filter((s) => s.stat === stat));
if (liveB.length) {
  console.log(`\n   live ${LIVE} so far (not fit)`);
  line('all games', liveB);
  for (const ph of PHASES) line(ph, liveB.filter((s) => s.phase === ph));
}

// 3. Production: every fit + test season (keys re-picked on all of them).
const prodB = [...fitB, ...testB];
assignKeys(prodB);
const prod = buildSpread(prodB);
const scaled = addScaled(prod, prodB);
console.log(`\n   spreads: ${Object.keys(prod.cuts).sort().join(' ')}`);
console.log(`   scaled:  ${scaled.join(' · ') || 'none'}`);
writeFileSync(
  `data/research/${league}-prop-spread.json`,
  JSON.stringify({ league, fitSeasons: [...FIT, ...TEST], baseline: best, earlyGames: EARLY_GAMES, test: { brier: all.brier, overMedian: all.overMedian, insideMiddle50: all.insideMiddle50, bins: all.bins, early: earlyScore.bins }, ...prod }),
);
console.log(`\nwrote data/research/${league}-prop-spread.json`);
