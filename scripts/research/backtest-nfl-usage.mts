/**
 * Walk-forward backtest of the NFL usage model (lib/research/nfl-usage.ts)
 * against the current prop baseline (season average, 25% weight on the last 3).
 *
 *   npx tsx scripts/research/backtest-nfl-usage.mts
 *
 * Every projection uses only earlier games. Team volume is fit on 2021-2023 and
 * player parameters are chosen on 2021-2023; 2024-2025 are held out. Both models
 * get an outcome spread fit on 2021-2023 the same way, and are scored on the same
 * lines (Brier: lower is better). Writes data/research/nfl-usage-model.json.
 */
import { writeFileSync } from 'node:fs';
import { baseline, minBase, POS_STATS, type PropPos, type PropStat } from '../../lib/research/nfl-props';
import {
  DEFAULT_PARAMS, defenseVsPosition, dot, nflUsageData, ols, playerShares, positionMeans, projectPlayer, redistribute, volumeFeatures,
  type PosMeans, type Shares, type TeamGame, type UsageGame, type UsageParams, type VolumeModel,
} from '../../lib/research/nfl-usage';
import { buildSpread, chanceOver, type SpreadModel } from '../../lib/research/props-engine';

const FIT = [2021, 2022, 2023];
const TEST = [2024, 2025];
const ALL = [2020, ...FIT, ...TEST];

const data = new Map<number, Awaited<ReturnType<typeof nflUsageData>>>();
for (const s of ALL) data.set(s, await nflUsageData(s));
console.log(ALL.map((s) => `${s}: ${data.get(s)!.players.length} player-games`).join(' · '));

const teamKey = (gameId: string, team: string) => `${gameId}|${team}`;
const teamIdx = new Map<string, TeamGame>();
for (const d of data.values()) for (const t of d.teams) teamIdx.set(teamKey(t.gameId, t.team), t);
const teamOf = (g: UsageGame) => teamIdx.get(teamKey(g.gameId, g.team));

// --- 1. Team volume model ---------------------------------------------------
const STATS3 = ['tgt', 'car', 'att'] as const;
type VolRow = { season: number; x: Record<string, number[]>; y: Record<string, number> };
const volRows: VolRow[] = [];
for (const s of [...FIT, ...TEST]) {
  const { teams } = data.get(s)!;
  const prev = data.get(s - 1)!.teams;
  for (const t of teams) {
    if (t.week < 2 || !t.att) continue;
    const prior = teams.filter((g) => g.week < t.week);
    const x: Record<string, number[]> = {};
    let ok = true;
    for (const k of STATS3) {
      const f = volumeFeatures(t, prior, prev, k);
      if (!f) ok = false;
      else x[k] = f;
    }
    if (ok) volRows.push({ season: s, x, y: { tgt: t.tgt, car: t.car, att: t.att } });
  }
}
const fitVol = (seasons: number[]) =>
  Object.fromEntries(STATS3.map((k) => {
    const rows = volRows.filter((r) => seasons.includes(r.season));
    return [k, ols(rows.map((r) => r.x[k]), rows.map((r) => r.y[k]))];
  })) as VolumeModel;
const vol = fitVol(FIT);
console.log('\n1. Team volume: [1, implied total, spread, team avg, opp allowed]');
for (const k of STATS3) {
  const test = volRows.filter((r) => TEST.includes(r.season));
  const mae = test.reduce((a, r) => a + Math.abs(dot(vol[k], r.x[k]) - r.y[k]), 0) / test.length;
  const maeAvg = test.reduce((a, r) => a + Math.abs(r.x[k][3] - r.y[k]), 0) / test.length;
  console.log(`   ${k}: coef ${vol[k].map((c) => c.toFixed(3)).join(', ')} · test MAE ${mae.toFixed(2)} vs team avg alone ${maeAvg.toFixed(2)}`);
}

// --- 2. Player projections ------------------------------------------------------
const means: PosMeans = positionMeans(FIT.flatMap((s) => data.get(s)!.players));
const byPlayer = new Map<string, UsageGame[]>();
for (const s of ALL) for (const g of data.get(s)!.players) (byPlayer.get(g.id) ?? byPlayer.set(g.id, []).get(g.id)!).push(g);
for (const l of byPlayer.values()) l.sort((a, b) => a.season - b.season || a.week - b.week);
const STAT_OF: Record<PropStat, (g: UsageGame) => number> = {
  passYds: (g) => g.passYds, passAtt: (g) => g.att, passTd: (g) => g.passTd, rushYds: (g) => g.rushYds,
  carries: (g) => g.car, recYds: (g) => g.recYds, receptions: (g) => g.rec, targets: (g) => g.tgt,
};

type Sample = { season: number; pos: PropPos; stat: PropStat; key: string; old: number; neu: number; actual: number; vac: number; dvp: number };
const dvpCache = new Map<string, ReturnType<typeof defenseVsPosition>>();
const dvpAt = (s: number, w: number) => dvpCache.get(`${s}|${w}`) ?? dvpCache.set(`${s}|${w}`, defenseVsPosition(data.get(s)!.players, w)).get(`${s}|${w}`)!;

function run(seasons: number[], p: UsageParams, volModel: VolumeModel): Sample[] {
  const out: Sample[] = [];
  for (const s of seasons) {
    const { players, teams } = data.get(s)!;
    const prevTeams = data.get(s - 1)!.teams;
    const weeks = [...new Set(teams.map((t) => t.week))].sort((a, b) => a - b);
    for (const w of weeks) {
      if (w < 4) continue; // the old baseline needs 3 games
      const prior = teams.filter((g) => g.week < w);
      for (const t of teams.filter((g) => g.week === w)) {
        const vf = STATS3.map((k) => volumeFeatures(t, prior, prevTeams, k));
        if (vf.some((f) => !f)) continue;
        const volume = { tgt: dot(volModel.tgt, vf[0]!), car: dot(volModel.car, vf[1]!), att: dot(volModel.att, vf[2]!) };
        // Regulars: played for this team in its last 3 games.
        const recentWeeks = prior.filter((g) => g.team === t.team).map((g) => g.week).sort((a, b) => b - a).slice(0, 3);
        // Regulars: played 2+ of the team's last 3 games for this team.
        const recentCount = new Map<string, number>();
        for (const g of players) if (g.team === t.team && recentWeeks.includes(g.week) && g.snap > 0) recentCount.set(g.id, (recentCount.get(g.id) ?? 0) + 1);
        const regulars = new Set([...recentCount].filter(([, n]) => n >= Math.min(2, recentWeeks.length)).map(([id]) => id));
        const thisGame = players.filter((g) => g.gameId === t.gameId && g.team === t.team && g.snap > 0);
        const activeIds = new Set(thisGame.map((g) => g.id));
        const hist = (id: string) => (byPlayer.get(id) ?? []).filter((g) => g.season === s - 1 || (g.season === s && g.week < w));
        const shares = new Map<string, Shares>();
        for (const id of new Set([...regulars, ...activeIds])) {
          const sh = playerShares(hist(id), teamOf, s, p);
          if (sh) shares.set(id, sh);
        }
        const active = new Map([...shares].filter(([id]) => activeIds.has(id)));
        // A missing regular's share is measured from his games with this team this season; 10%+ only.
        const missing = [...regulars]
          .filter((id) => !activeIds.has(id))
          .map((id) => playerShares(hist(id).filter((g) => g.season === s && g.team === t.team), teamOf, s, p))
          .filter((sh): sh is Shares => !!sh)
          .map((sh) => ({ tgt: sh.tgt >= 0.1 ? sh.tgt : 0, car: sh.car >= 0.1 ? sh.car : 0, att: 0 }));
        const adj = redistribute(active, missing, p.rho);
        const vacT = missing.reduce((a, m) => a + m.tgt, 0), vacC = missing.reduce((a, m) => a + m.car, 0);
        for (const g of thisGame) {
          const sh = adj.get(g.id);
          if (!sh) continue;
          const h = hist(g.id);
          const cur = h.filter((x) => x.season === s && x.snap > 0);
          if (cur.length < 3) continue;
          const proj = projectPlayer(g.pos, h, sh, volume, t.implied!, means, s, p);
          for (const stat of POS_STATS[g.pos]) {
            const old = baseline(cur.map(STAT_OF[stat]));
            const neu = proj[stat];
            if (old == null || neu == null || old < minBase(g.pos, stat) || neu <= 0) continue;
            out.push({ season: s, pos: g.pos, stat, key: `${g.pos}|${stat}`, old, neu, actual: STAT_OF[stat](g), vac: stat === 'carries' || stat === 'rushYds' ? vacC : vacT, dvp: dvpAt(s, w).get(`${g.opp}|${g.pos}|${stat}`)?.ratio ?? 1 });
          }
        }
      }
    }
  }
  return out;
}

const keys = (ss: Sample[]) => [...new Set(ss.map((x) => x.key))].sort();
const mae = (ss: Sample[], f: (x: Sample) => number) => ss.reduce((a, x) => a + Math.abs(f(x) - x.actual), 0) / (ss.length || 1);
const relErr = (ss: Sample[]) => {
  const ks = keys(ss);
  return ks.reduce((a, k) => {
    const g = ss.filter((x) => x.key === k);
    return a + mae(g, (x) => x.neu) / mae(g, (x) => x.old);
  }, 0) / ks.length;
};

console.log('\n2. Parameter search on 2021-2023 (relative error vs the current baseline; < 1 is better)');
let best = DEFAULT_PARAMS, bestScore = Infinity;
for (const halfLife of [4, 8, 16, 1000]) {
  for (const prevWeight of [0.25, 0.5]) {
    for (const tdImplied of [0, 1]) {
      const p = { ...DEFAULT_PARAMS, halfLife, prevWeight, rho: 0, tdImplied };
      const sc = relErr(run(FIT, p, vol));
      if (sc < bestScore) [best, bestScore] = [p, sc];
    }
  }
}
// Teammate absences matter only where they happen: choose rho on games where a regular
// with 15%+ of the team's targets (or carries) was out.
{
  let bestRho = 0, bestR = Infinity;
  for (const rho of [0, 0.25, 0.5, 0.75, 1]) {
    const ss = run(FIT, { ...best, rho }, vol).filter((x) => x.vac >= 0.15);
    const r = relErr(ss);
    console.log(`   rho ${rho}: ${ss.length} props with a 15%+ teammate out → ${(100 * (r - 1)).toFixed(1)}% vs current`);
    if (r < bestR) [bestRho, bestR] = [rho, r];
  }
  best = { ...best, rho: bestRho };
}
console.log(`   best: half-life ${best.halfLife} games, last season ×${best.prevWeight}, teammate share handed on ×${best.rho}, TD ∝ implied^${best.tdImplied} → ${(100 * (bestScore - 1)).toFixed(1)}% error vs current`);

// --- 3. Held-out seasons --------------------------------------------------------
const fitS = run(FIT, best, vol);
const testS = run(TEST, best, vol);
const sOld = buildSpread(fitS.map((x) => ({ key: x.key, base: x.old, actual: x.actual })));
const sNew = buildSpread(fitS.map((x) => ({ key: x.key, base: x.neu, actual: x.actual })));
const linesFor = (x: Sample) => {
  if (x.stat === 'passTd') return [0.5, 1.5, 2.5];
  const set = new Set<number>();
  for (const b of [x.old, x.neu]) for (const m of [0.7, 0.85, 1, 1.15, 1.3]) set.add(Math.round(b * m) + 0.5);
  return [...set];
};
type Score = { brier: number; n: number; bins: Array<{ said: number; hit: number; n: number }> };
const score = (ss: Sample[], model: SpreadModel, base: (x: Sample) => number): Score => {
  const sc: Score = { brier: 0, n: 0, bins: [0, 1, 2, 3, 4].map(() => ({ said: 0, hit: 0, n: 0 })) };
  for (const x of ss) {
    for (const line of linesFor(x)) {
      const pr = chanceOver(model, x.key, base(x), line) ?? 0.5;
      const y = x.actual > line ? 1 : 0;
      sc.brier += (pr - y) ** 2;
      sc.n++;
      const b = sc.bins[pr < 0.3 ? 0 : pr < 0.45 ? 1 : pr < 0.55 ? 2 : pr < 0.7 ? 3 : 4];
      b.said += pr;
      b.hit += y;
      b.n++;
    }
  }
  sc.brier /= sc.n || 1;
  return sc;
};
const binStr = (s: Score) => s.bins.filter((b) => b.n).map((b) => `${Math.round((100 * b.said) / b.n)}→${Math.round((100 * b.hit) / b.n)}`).join('  ');

console.log(`\n3. Held out ${TEST.join(', ')}: ${testS.length} player-game props`);
console.log('   prop            n     MAE current → usage      Brier current → usage');
const rows: Array<{ key: string; n: number; maeOld: number; maeNew: number; brierOld: number; brierNew: number }> = [];
for (const k of keys(testS)) {
  const g = testS.filter((x) => x.key === k);
  const bo = score(g, sOld, (x) => x.old), bn = score(g, sNew, (x) => x.neu);
  rows.push({ key: k, n: g.length, maeOld: mae(g, (x) => x.old), maeNew: mae(g, (x) => x.neu), brierOld: bo.brier, brierNew: bn.brier });
  const r = rows.at(-1)!;
  console.log(`   ${k.padEnd(15)} ${String(r.n).padStart(5)}   ${r.maeOld.toFixed(2).padStart(7)} → ${r.maeNew.toFixed(2).padEnd(7)} ${(100 * (r.maeNew / r.maeOld - 1)).toFixed(1).padStart(5)}%   ${r.brierOld.toFixed(4)} → ${r.brierNew.toFixed(4)}`);
}
const vacS = testS.filter((x) => x.vac >= 0.15);
console.log(`   with a 15%+ teammate out (n=${vacS.length}): MAE ${mae(vacS, (x) => x.old).toFixed(2)} → ${mae(vacS, (x) => x.neu).toFixed(2)} · Brier ${score(vacS, sOld, (x) => x.old).brier.toFixed(4)} → ${score(vacS, sNew, (x) => x.neu).brier.toFixed(4)}`);
const allOld = score(testS, sOld, (x) => x.old), allNew = score(testS, sNew, (x) => x.neu);
console.log(`   all: Brier ${allOld.brier.toFixed(4)} → ${allNew.brier.toFixed(4)}`);
console.log(`   calibration current: ${binStr(allOld)}`);
console.log(`   calibration usage:   ${binStr(allNew)}`);

// --- 4. Defense vs position ---------------------------------------------------
// Does what the opponent has allowed to this position (shrunk ratio vs league) improve the projection?
// projection × ratio^beta, beta per prop chosen on 2021-2023, judged on 2024-2025.
const BETAS = [0, 0.25, 0.5, 0.75, 1];
const dvpBeta: Record<string, number> = {};
console.log('\n4. Defense vs position: projection × (opp allowed to position / league)^beta');
for (const k of keys(fitS)) {
  const f = fitS.filter((x) => x.key === k);
  dvpBeta[k] = BETAS.reduce((b, beta) => (mae(f, (x) => x.neu * x.dvp ** beta) < mae(f, (x) => x.neu * x.dvp ** b) ? beta : b), 0);
  const t = testS.filter((x) => x.key === k);
  const m0 = mae(t, (x) => x.neu), m1 = mae(t, (x) => x.neu * x.dvp ** dvpBeta[k]);
  console.log(`   ${k.padEnd(15)} beta ${dvpBeta[k].toFixed(2)} · test MAE ${m0.toFixed(2)} → ${m1.toFixed(2)} (${(100 * (m1 / m0 - 1)).toFixed(1)}%)`);
}
const adjOf = (x: Sample) => x.neu * x.dvp ** (dvpBeta[x.key] ?? 0);
const sAdj = buildSpread(fitS.map((x) => ({ key: x.key, base: adjOf(x), actual: x.actual })));
const allAdj = score(testS, sAdj, adjOf);
console.log(`   all: Brier ${allNew.brier.toFixed(4)} → ${allAdj.brier.toFixed(4)} · calibration ${binStr(allAdj)}`);
// Strong matchups only (opponent allows 15%+ more or less than average): does the adjustment help where it bites?
const strong = testS.filter((x) => Math.abs(x.dvp - 1) >= 0.15);
console.log(`   strong matchups (n=${strong.length}): MAE ${mae(strong, (x) => x.neu).toFixed(2)} → ${mae(strong, adjOf).toFixed(2)}`);

// Production: volume and spread refit on every season, with the chosen parameters.
const prodVol = fitVol([...FIT, ...TEST]);
const prodSamples = run([...FIT, ...TEST], best, prodVol);
const prodSpread = buildSpread(prodSamples.map((x) => ({ key: x.key, base: adjOf(x), actual: x.actual })));
writeFileSync(
  'data/research/nfl-usage-model.json',
  JSON.stringify({ fitSeasons: [...FIT, ...TEST], params: best, dvpBeta, dvpTest: { brierBefore: allNew.brier, brierAfter: allAdj.brier }, volume: prodVol, means: positionMeans([...FIT, ...TEST].flatMap((s) => data.get(s)!.players)), test: rows, spread: prodSpread }),
);
console.log('\nwrote data/research/nfl-usage-model.json');
