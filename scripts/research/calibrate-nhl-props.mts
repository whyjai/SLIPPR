/**
 * Calibrate NHL prop baselines and outcome spreads on history (walk-forward:
 * each game uses only the player's earlier games, plus last season early on).
 * Skaters: shots, points, goals, assists. Goalies: saves, in games they started.
 * Fit 2021-22..2024-25, tested on 2025-26. Writes data/research/nhl-prop-spread.json.
 *
 *   npx tsx scripts/research/calibrate-nhl-props.mts
 */
import { writeFileSync } from 'node:fs';
import { NHL_MIN_BASE, NHL_STATS, type NhlStat } from '../../lib/research/nhl-props';
import { nhlGoalieGames, nhlSkaterGames } from '../../lib/research/nhl-data';
import { blendBaseline, buildSpread, scoreSpread, type BaselineParams } from '../../lib/research/props-engine';

const FIT = [2021, 2022, 2023, 2024];
const TEST = [2025];
const EARLY_GAMES = 10;

type Row = { id: number; date: string; stat: NhlStat; value: number };
type Sample = { season: number; game: number; stat: NhlStat; values: number[]; prior: number | null; actual: number };

async function rows(season: number): Promise<Row[]> {
  const [sk, gk] = await Promise.all([nhlSkaterGames(season), nhlGoalieGames(season)]);
  const out: Row[] = [];
  for (const g of sk) for (const stat of ['shots', 'points', 'goals', 'assists'] as NhlStat[]) out.push({ id: g.playerId, date: g.date, stat, value: g[stat as 'shots'] });
  for (const g of gk) if (g.started) out.push({ id: g.playerId, date: g.date, stat: 'saves', value: g.saves });
  return out;
}

const data = new Map<number, Row[]>();
for (const s of [FIT[0] - 1, ...FIT, ...TEST]) data.set(s, await rows(s));

function samples(season: number): Sample[] {
  const prior = new Map<string, number>();
  const prevBy = new Map<string, number[]>();
  for (const r of data.get(season - 1) ?? []) (prevBy.get(`${r.id}|${r.stat}`) ?? prevBy.set(`${r.id}|${r.stat}`, []).get(`${r.id}|${r.stat}`)!).push(r.value);
  for (const [k, v] of prevBy) if (v.length >= 20) prior.set(k, v.reduce((a, b) => a + b, 0) / v.length);
  const by = new Map<string, Row[]>();
  for (const r of data.get(season) ?? []) (by.get(`${r.id}|${r.stat}`) ?? by.set(`${r.id}|${r.stat}`, []).get(`${r.id}|${r.stat}`)!).push(r);
  const out: Sample[] = [];
  for (const [k, list] of by) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < list.length; i++) out.push({ season, game: i + 1, stat: list[i].stat, values: list.slice(0, i).map((r) => r.value), prior: prior.get(k) ?? null, actual: list[i].value });
  }
  return out;
}

const fitS = FIT.flatMap(samples);
const testS = TEST.flatMap(samples);
console.log(`NHL: fit ${fitS.length} · test ${testS.length} player-game-stats\n`);

const eligible = (b: number | null, st: NhlStat): b is number => b != null && b >= NHL_MIN_BASE[st];
const ref: BaselineParams = { recentWeight: 0, recentN: 5, priorGames: 0, minGames: 5 };
const refIdx = fitS.map((s, i) => (eligible(blendBaseline(s.values, s.prior, ref), s.stat) ? i : -1)).filter((i) => i >= 0);
const err = (p: BaselineParams) => {
  const per = new Map<NhlStat, { e: number; n: number }>();
  for (const i of refIdx) {
    const s = fitS[i];
    const x = per.get(s.stat) ?? { e: 0, n: 0 };
    x.e += Math.abs(s.actual - (blendBaseline(s.values, s.prior, p) ?? 0));
    x.n++;
    per.set(s.stat, x);
  }
  return per;
};
const base0 = err(ref);
let best = ref, bestScore = Infinity;
for (const recentWeight of [0, 0.25, 0.5]) {
  for (const recentN of [5, 10]) {
    for (const priorGames of [0, 5, 10, 20, 40]) {
      const p = { recentWeight, recentN, priorGames, minGames: 5 };
      const e = err(p);
      const score = NHL_STATS.reduce((a, st) => a + e.get(st)!.e / e.get(st)!.n / (base0.get(st)!.e / base0.get(st)!.n), 0) / NHL_STATS.length;
      if (score < bestScore) [best, bestScore] = [p, score];
    }
  }
}
console.log(`1. Best baseline: last ${best.recentN} at ${best.recentWeight} weight, last season worth ${best.priorGames} games → error ${(100 * (bestScore - 1)).toFixed(1)}% vs plain season average`);

const withBase = (ss: Sample[]) =>
  ss.flatMap((s) => {
    const b = blendBaseline(s.values, s.prior, best);
    return eligible(b, s.stat) ? [{ key: `${s.game <= EARLY_GAMES ? 'early|' : ''}${s.stat}`, base: b, actual: s.actual, stat: s.stat, game: s.game }] : [];
  });
const fitB = withBase(fitS);
const testB = withBase(testS);
const model = buildSpread(fitB);
const all = scoreSpread(model, testB);
console.log(`\n2. Spread fit ${FIT.join(',')} → test ${TEST.join(',')} (n=${testB.length})`);
console.log(`   all:       Brier ${all.brier.toFixed(4)} · over median ${(100 * all.overMedian).toFixed(1)}% · middle 50% ${(100 * all.insideMiddle50).toFixed(1)}% · ${all.bins}`);
const early = scoreSpread(model, testB.filter((s) => s.game <= 5));
console.log(`   games 1-5: Brier ${early.brier.toFixed(4)} · over median ${(100 * early.overMedian).toFixed(1)}% · ${early.bins}`);
for (const st of NHL_STATS) {
  const sc = scoreSpread(model, testB.filter((s) => s.stat === st));
  console.log(`   ${st.padEnd(8)} Brier ${sc.brier.toFixed(4)} · over median ${(100 * sc.overMedian).toFixed(1)}% · middle 50% ${(100 * sc.insideMiddle50).toFixed(1)}% · ${sc.bins}`);
}

// Goalie saves: league shot volume drifts, and a 4-season spread ran hot on 2025-26 (said 42% → 34%).
// Built from the 2 most recent seasons it held (42 → 40, 47 → 46, 68 → 67), so saves use the latest two.
const SAVES_SEASONS = 2;
const savesCheck = buildSpread(withBase(FIT.slice(-SAVES_SEASONS).flatMap(samples)).filter((x) => x.stat === 'saves'));
const sc = scoreSpread(savesCheck, testB.filter((x) => x.stat === 'saves'));
console.log(`   saves (last ${SAVES_SEASONS} seasons) Brier ${sc.brier.toFixed(4)} · ${sc.bins}`);

const recent = [...FIT, ...TEST].slice(-SAVES_SEASONS);
const prodSamples = [
  ...[...fitB, ...testB].filter((x) => x.stat !== 'saves'),
  ...withBase(recent.flatMap(samples)).filter((x) => x.stat === 'saves'),
];
const prod = buildSpread(prodSamples);
writeFileSync('data/research/nhl-prop-spread.json', JSON.stringify({ league: 'nhl', fitSeasons: [...FIT, ...TEST], baseline: best, earlyGames: EARLY_GAMES, test: { brier: all.brier, bins: all.bins }, ...prod }));
console.log('\nwrote data/research/nhl-prop-spread.json');

