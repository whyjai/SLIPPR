/**
 * Does the research carry signal? Uses a completed season to measure:
 *   1. how well early defense-vs-position ranks predict the rest of the season
 *      (which stats get matchup notes, which are flagged noisy)
 *   2. how stable team tendencies are between halves of the season
 *   3. whether a player's split vs. a look (blitz, man, box) repeats, and the
 *      SPLIT_TRUST sample size m that lib/research/nfl-teams.ts shrinks by
 *
 *   npx tsx scripts/research/audit-nfl.mts 2025
 *
 * Re-run after each season and update NOTE_METRICS / noisy flags
 * (nfl-defense.ts) and SPLIT_TRUST (nfl-teams.ts) if the picture changes.
 */
import { computeDefense, METRICS, POSITIONS } from '../../lib/research/nfl-defense';
import { aggregate, loadCharting, loadCoverage, loadPlays, type SeasonAggregate } from '../../lib/research/nfl-pbp';
import { playerWeeks } from '../../lib/research/nflverse';

const season = Number(process.argv[2] ?? 2025);
if (!Number.isInteger(season)) throw new Error('usage: audit-nfl.mts <completed season>');

type Counter = Record<string, number>;
const pearson = (xs: number[], ys: number[]) => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const sum = (cs: Array<Counter | undefined>): Counter => {
  const o: Counter = {};
  for (const c of cs) for (const [k, v] of Object.entries(c ?? {})) o[k] = (o[k] ?? 0) + v;
  return o;
};

// 1. Defense vs position: early per-game allowed vs the rest of the season.
const weeks = (await playerWeeks(season)).filter((w) => w.seasonType === 'REG');
console.log('1. Defense vs position, per game allowed: weeks 1-N vs the rest (r)');
for (const cut of [3, 6, 9]) {
  const early = computeDefense(weeks.filter((w) => w.week <= cut)).rows;
  const late = computeDefense(weeks.filter((w) => w.week > cut)).rows;
  const out: string[] = [];
  for (const pos of POSITIONS) {
    for (const m of METRICS[pos]) {
      const teams = early.map((r) => r.team).filter((t) => late.some((r) => r.team === t));
      const a = teams.map((t) => early.find((r) => r.team === t)!.stats[pos][m.key].perGame);
      const b = teams.map((t) => late.find((r) => r.team === t)!.stats[pos][m.key].perGame);
      out.push(`${pos} ${m.short}${m.noisy ? '*' : ''} ${f2(pearson(a, b))}`);
    }
  }
  console.log(`   N=${cut}: ${out.join(' | ')}`);
}
console.log('   (* = flagged noisy on the site)\n');

// 2. Team tendencies: stability between halves of the season.
const [plays, charting, coverage] = await Promise.all([loadPlays(season), loadCharting(season), loadCoverage(season)]);
const aggOf = (keep: (week: number) => boolean) => aggregate(season, plays.filter((p) => keep(p.week)), charting, coverage);
const rate = (a: SeasonAggregate, side: 'offense' | 'defense', num: string, den: string) =>
  Object.fromEntries(Object.entries(a.teams).map(([t, c]) => [t, (c[side][num] ?? 0) / (c[side][den] || 1)]));
const TENDENCIES: Array<[string, 'offense' | 'defense', string, string]> = [
  ['neutral pass', 'offense', 'neutralPass', 'neutralPlays'],
  ['PROE', 'offense', 'passOeSum', 'passOeN'],
  ['pace', 'offense', 'paceSum', 'paceN'],
  ['play-action', 'offense', 'playAction', 'chartedDropbacks'],
  ['motion', 'offense', 'motion', 'charted'],
  ['blitz', 'defense', 'blitzes', 'chartedDropbacks'],
  ['man', 'defense', 'man', 'coverageSnaps'],
  ['stacked box', 'defense', 'stackedBox', 'boxRuns'],
  ['EPA/db allowed', 'defense', 'passEpa', 'passPlays'],
  ['EPA/rush allowed', 'defense', 'rushEpa', 'runPlays'],
];
const SPLITS: Array<[string, (w: number) => boolean, (w: number) => boolean]> = [
  ['weeks 1-3 vs 4+', (w) => w <= 3, (w) => w > 3],
  ['odd vs even weeks', (w) => w % 2 === 1, (w) => w % 2 === 0],
];
console.log('2. Team tendencies, team-level r between samples');
for (const [label, a, b] of SPLITS) {
  const A = aggOf(a), B = aggOf(b);
  const out = TENDENCIES.map(([name, side, num, den]) => {
    const ra = rate(A, side, num, den), rb = rate(B, side, num, den);
    const teams = Object.keys(ra).filter((t) => rb[t] != null);
    return `${name} ${f2(pearson(teams.map((t) => ra[t]), teams.map((t) => rb[t])))}`;
  });
  console.log(`   ${label}: ${out.join(' | ')}`);
}

// 3. Player splits vs a look: does the on-minus-off gap repeat? m = h(1-r)/r.
console.log('\n3. Player split reliability (gap between halves of his season) -> SPLIT_TRUST m');
type Test = { name: string; on: string; off: string[]; stat: (c: Counter) => number | null; n: (c: Counter) => number; min: number };
const TESTS: Test[] = [
  { name: 'qbBlitz (yds/dropback)', on: 'blitz', off: ['noBlitz'], stat: (c) => (c.dropbacks ? (c.dbYards ?? 0) / c.dropbacks : null), n: (c) => c.dropbacks ?? 0, min: 20 },
  { name: 'recMan (yds/target)', on: 'man', off: ['zone'], stat: (c) => (c.targets ? (c.recYds ?? 0) / c.targets : null), n: (c) => c.targets ?? 0, min: 8 },
  { name: 'rbStacked (yds/carry)', on: 'stackedBox', off: ['lightBox', 'normalBox'], stat: (c) => (c.carries ? (c.rushYds ?? 0) / c.carries : null), n: (c) => c.carries ?? 0, min: 4 },
  { name: 'rbLight (yds/carry)', on: 'lightBox', off: ['normalBox', 'stackedBox'], stat: (c) => (c.carries ? (c.rushYds ?? 0) / c.carries : null), n: (c) => c.carries ?? 0, min: 8 },
  { name: 'qbPlayAction (yds/att)', on: 'playAction', off: ['noPlayAction'], stat: (c) => (c.att ? (c.passYds ?? 0) / c.att : null), n: (c) => c.att ?? 0, min: 15 },
];
const HALVES: Array<[string, (w: number) => boolean, (w: number) => boolean]> = [
  ['odd/even', (w) => w % 2 === 1, (w) => w % 2 === 0],
  ['1st/2nd half', (w) => w <= 9, (w) => w > 9],
  ['thirds', (w) => w % 3 !== 0, (w) => w % 3 === 0],
];
const full = aggOf(() => true).players;
for (const t of TESTS) {
  const results: string[] = [];
  for (const [label, a, b] of HALVES) {
    const A = aggOf(a).players, B = aggOf(b).players;
    const ga: number[] = [], gb: number[] = [], hs: number[] = [];
    for (const id of Object.keys(A)) {
      const sa = A[id]?.splits as Record<string, Counter> | undefined;
      const sb = B[id]?.splits as Record<string, Counter> | undefined;
      if (!sa || !sb) continue;
      const aOn = sa[t.on] ?? {}, bOn = sb[t.on] ?? {};
      const aOff = sum(t.off.map((l) => sa[l])), bOff = sum(t.off.map((l) => sb[l]));
      if ([aOn, bOn, aOff, bOff].some((c) => t.n(c) < t.min)) continue;
      ga.push(t.stat(aOn)! - t.stat(aOff)!);
      gb.push(t.stat(bOn)! - t.stat(bOff)!);
      hs.push(2 / (1 / t.n(aOn) + 1 / t.n(aOff)));
    }
    const r = pearson(ga, gb);
    const h = hs.sort((x, y) => x - y)[hs.length >> 1] ?? 0;
    results.push(`${label} r ${f2(r)} (n=${ga.length}, h≈${Math.round(h)}, m ${r > 0 ? Math.round((h * (1 - r)) / r) : '∞'})`);
  }
  const lgOn = sum(Object.values(full).map((p) => (p.splits as Record<string, Counter>)[t.on]));
  const lgOff = sum(t.off.flatMap((l) => Object.values(full).map((p) => (p.splits as Record<string, Counter>)[l])));
  console.log(`   ${t.name}: ${results.join(' | ')} | league ${f2(t.stat(lgOn)!)} vs ${f2(t.stat(lgOff)!)}`);
}
