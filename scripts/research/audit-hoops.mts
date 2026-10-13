/**
 * Basketball signal audit (NBA or WNBA). For a pair of completed seasons it measures:
 *   1. how well early defense-vs-position (G/F/C) predicts the rest of the season
 *   2. how stable team tendencies are (first N games vs the rest)
 *   3. how much an opponent's style (pace, defensive rating, threes and paint
 *      points allowed) moves a player's line, fit on one season and tested on
 *      the next. Prints the style-effects table lib/research/hoops-matchups.ts uses.
 *
 *   npx tsx scripts/research/audit-hoops.mts nba 2025 2026    (league, fit season, test season)
 *   npx tsx scripts/research/audit-hoops.mts wnba 2025 2026
 */
import { LEAGUES, isLeague, type League, playerGames, teamGames, type HoopsPlayerGame, type HoopsPos, type HoopsTeamGame } from '../../lib/research/hoops-data';
import { STYLE_PREDICTORS, type StyleKey, type StyleStat } from '../../lib/research/hoops-matchups';
import { teamStyles } from '../../lib/research/hoops-teams';

const arg = process.argv[2] ?? 'nba';
if (!isLeague(arg)) throw new Error('usage: audit-hoops.mts <nba|wnba> <fit season> <test season>');
const league: League = arg;
const fitSeason = Number(process.argv[3] ?? 2025);
const testSeason = Number(process.argv[4] ?? fitSeason + 1);
const { regulation, seasonGames } = LEAGUES[league];
const half = Math.floor(seasonGames / 2);
const cuts = [Math.round(seasonGames / 8), Math.round(seasonGames / 4), half];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const pearson = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');

/** Least squares with intercept; returns [intercept, ...slopes]. Solved by Gaussian elimination. */
function ols(X: number[][], y: number[]): number[] {
  const k = X[0].length + 1;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < y.length; i++) {
    const row = [1, ...X[i]];
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a][b] += row[a] * row[b];
      A[a][k] += row[a] * y[i];
    }
  }
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

/** Split each team's season at game `cut` (by date). */
function halves(teams: HoopsTeamGame[], cut: number) {
  const byTeam = new Map<string, HoopsTeamGame[]>();
  for (const g of teams) byTeam.set(g.team, [...(byTeam.get(g.team) ?? []), g]);
  const idx = new Map<string, number>();
  for (const [t, gs] of byTeam) gs.sort((a, b) => a.date.localeCompare(b.date)).forEach((g, i) => idx.set(`${g.gameId}|${t}`, i));
  const early = (gameId: string, team: string) => (idx.get(`${gameId}|${team}`) ?? 0) < cut;
  return { early, idx };
}

const STAT: Record<StyleStat, (p: HoopsPlayerGame) => number> = {
  pts: (p) => p.pts,
  reb: (p) => p.reb,
  ast: (p) => p.ast,
  fg3m: (p) => p.fg3m,
  pra: (p) => p.pts + p.reb + p.ast,
};
const STATS = Object.keys(STAT) as StyleStat[];

type Sample = { pos: HoopsPos; stat: StyleStat; z: number[]; ratio: number; base: number; actual: number };

/** Player-games from the second half of a season, with the opponent's first-half style z-scores. */
async function samples(season: number): Promise<Sample[]> {
  const [players, teams] = await Promise.all([playerGames(league, season), teamGames(league, season)]);
  const { early } = halves(teams, half);
  const styles = teamStyles(teams.filter((g) => early(g.gameId, g.team)), regulation);
  const keys = [...new Set(Object.values(STYLE_PREDICTORS).flat())] as StyleKey[];
  const lg = Object.fromEntries(keys.map((k) => [k, mean(Object.values(styles).map((s) => s[k]))]));
  const sds = Object.fromEntries(keys.map((k) => [k, sd(Object.values(styles).map((s) => s[k]))]));
  const base = new Map<string, { n: number; min: number } & Record<StyleStat, number>>();
  for (const p of players) {
    if (!early(p.gameId, p.team)) continue;
    const b = base.get(p.playerId) ?? { n: 0, min: 0, pts: 0, reb: 0, ast: 0, fg3m: 0, pra: 0 };
    b.n++;
    b.min += p.min;
    for (const s of STATS) b[s] += STAT[s](p);
    base.set(p.playerId, b);
  }
  const out: Sample[] = [];
  for (const p of players) {
    if (early(p.gameId, p.team) || !p.pos || !styles[p.opp]) continue;
    const b = base.get(p.playerId);
    if (!b || b.n < half / 2 || b.min / b.n < regulation * 0.42) continue; // ~20 mpg NBA, ~17 WNBA
    for (const stat of STATS) {
      const avg = b[stat] / b.n;
      if (avg < 0.5) continue;
      const z = STYLE_PREDICTORS[stat].map((k) => (styles[p.opp][k] - lg[k]) / sds[k]);
      out.push({ pos: p.pos, stat, z, ratio: STAT[stat](p) / avg - 1, base: avg, actual: STAT[stat](p) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1 + 2. Defense vs position and team tendencies: early vs rest (test season)
{
  const [players, teams] = await Promise.all([playerGames(league, testSeason), teamGames(league, testSeason)]);
  console.log(`${LEAGUES[league].name}\n1. Defense vs position (${testSeason}), per game allowed: first N games vs the rest (r)`);
  for (const cut of cuts) {
    const { early } = halves(teams, cut);
    const agg = (keep: (e: boolean) => boolean) => {
      const tot = new Map<string, number>();
      const games = new Map<string, Set<string>>();
      for (const p of players) {
        if (!p.pos || !keep(early(p.gameId, p.opp))) continue;
        (games.get(p.opp) ?? games.set(p.opp, new Set()).get(p.opp)!).add(p.gameId);
        for (const s of STATS) tot.set(`${p.opp}|${p.pos}|${s}`, (tot.get(`${p.opp}|${p.pos}|${s}`) ?? 0) + STAT[s](p));
      }
      return (team: string, pos: HoopsPos, s: StyleStat) => (tot.get(`${team}|${pos}|${s}`) ?? 0) / (games.get(team)?.size || 1);
    };
    const A = agg((e) => e), B = agg((e) => !e);
    const ts = [...new Set(teams.map((g) => g.team))];
    const cells = (['G', 'F', 'C'] as HoopsPos[]).flatMap((pos) => STATS.map((s) => `${pos} ${s} ${f2(pearson(ts.map((t) => A(t, pos, s)), ts.map((t) => B(t, pos, s))))}`));
    console.log(`   N=${cut}: ${cells.join(' | ')}`);
  }
  console.log(`\n2. Team tendencies (${testSeason}): first N games vs the rest (r)`);
  for (const cut of cuts) {
    const { early } = halves(teams, cut);
    const A = teamStyles(teams.filter((g) => early(g.gameId, g.team)), regulation);
    const B = teamStyles(teams.filter((g) => !early(g.gameId, g.team)), regulation);
    const ts = Object.keys(A);
    const keys = ['pace', 'ortg', 'drtg', 'efg', 'oppEfg', 'threeRate', 'oppThreeRate', 'ftRate', 'oppFtRate', 'oppPaint', 'orebPct', 'forcedTovPct'] as const;
    console.log(`   N=${cut}: ${keys.map((k) => `${k} ${f2(pearson(ts.map((t) => A[t][k]), ts.map((t) => B[t][k])))}`).join(' | ')}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Style effects: fit on one season, test on the next.
{
  const [fit, test] = await Promise.all([samples(fitSeason), samples(testSeason)]);
  const table: Record<string, Record<string, number[]>> = {};
  console.log(`\n3. Style effects, fit ${fitSeason} → test ${testSeason} (regulars; % change in his line per +1 SD of opponent style)`);
  for (const pos of ['G', 'F', 'C'] as HoopsPos[]) {
    table[pos] = {};
    for (const stat of STATS) {
      const tr = fit.filter((s) => s.pos === pos && s.stat === stat);
      const coef = ols(tr.map((s) => s.z), tr.map((s) => s.ratio)).slice(1);
      table[pos][stat] = coef.map((c) => Math.round(c * 1000) / 1000);
      const te = test.filter((s) => s.pos === pos && s.stat === stat);
      const proj = (s: Sample) => s.base * (1 + coef.reduce((a, c, i) => a + c * s.z[i], 0));
      const maeBase = mean(te.map((s) => Math.abs(s.actual - s.base)));
      const maeProj = mean(te.map((s) => Math.abs(s.actual - proj(s))));
      // Bias check: does the projected change point the right way? Correlate predicted and actual change.
      const r = pearson(te.map((s) => proj(s) - s.base), te.map((s) => s.actual - s.base));
      console.log(
        `   ${pos} ${stat.padEnd(4)} ${STYLE_PREDICTORS[stat].map((k, i) => `${k} ${(100 * coef[i]).toFixed(1)}%`).join(', ').padEnd(58)} ` +
          `test: MAE ${maeBase.toFixed(2)} → ${maeProj.toFixed(2)} (${(100 * (maeProj / maeBase - 1)).toFixed(1)}%), r(pred, actual change) ${f2(r)}, n=${te.length}`,
      );
    }
  }
  console.log('\nSTYLE_EFFECTS =', JSON.stringify(table));
}

// ---------------------------------------------------------------------------
// 4. Ratings-based game estimate: first part of a season predicting the rest.
{
  const mean2 = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  console.log(`\n4. Game estimate (pace + ratings + home edge) on later games, ${testSeason}`);
  const teams = await teamGames(league, testSeason);
  for (const cut of [cuts[1], half]) {
    const { early } = halves(teams, cut);
    const S = teamStyles(teams.filter((g) => early(g.gameId, g.team)), regulation);
    const lgPace = mean2(Object.values(S).map((x) => x.pace));
    const lgRtg = mean2(Object.values(S).map((x) => x.ortg));
    const byKey = new Map(teams.map((g) => [`${g.gameId}|${g.team}`, g]));
    const earlyHome = teams.filter((g) => g.home && early(g.gameId, g.team));
    const homeEdge = mean2(earlyHome.map((g) => g.pts - (byKey.get(`${g.gameId}|${g.opp}`)?.pts ?? g.pts)));
    const pt: number[] = [], at: number[] = [], pm: number[] = [], am: number[] = [], lt: number[] = [];
    for (const h of teams) {
      if (!h.home || early(h.gameId, h.team) || early(h.gameId, h.opp)) continue;
      const a = byKey.get(`${h.gameId}|${h.opp}`);
      const H = S[h.team], A = S[h.opp];
      if (!a || !H || !A) continue;
      const len = h.minutes / regulation;
      const pace = H.pace + A.pace - lgPace;
      const hp = (pace / 100) * (H.ortg + A.drtg - lgRtg) * len + homeEdge / 2;
      const ap = (pace / 100) * (A.ortg + H.drtg - lgRtg) * len - homeEdge / 2;
      pt.push(hp + ap); at.push(h.pts + a.pts); pm.push(hp - ap); am.push(h.pts - a.pts);
      lt.push(((2 * lgPace * lgRtg) / 100) * len);
    }
    const mae = (p: number[], a: number[]) => mean2(p.map((x, i) => Math.abs(x - a[i])));
    console.log(
      `   first ${cut} → rest (${pt.length} games): total r ${f2(pearson(pt, at))}, miss ${mae(pt, at).toFixed(1)} vs league avg ${mae(lt, at).toFixed(1)}` +
        ` | margin r ${f2(pearson(pm, am))}, miss ${mae(pm, am).toFixed(1)} vs pick'em ${mean2(am.map(Math.abs)).toFixed(1)}`,
    );
  }
}
