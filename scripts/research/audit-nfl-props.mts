/**
 * NFL prop audit: does the opponent's run/pass defense move a player's prop
 * stats beyond his own average, and by how much? Walk-forward: for every week
 * from 4 on, the player's baseline and the opponent's profile use only earlier
 * weeks. Effects are fit on one season and tested on the next.
 *
 *   npx tsx scripts/research/audit-nfl-props.mts 2024 2025
 *
 * Prints the PROP_EFFECTS table for lib/research/nfl-props.ts.
 */
import { baseline, defenseProfiles, minBase, nflDefenseGames, POS_STATS, posOf, PROP_FEATURES, STAT_COL, zScores, type Feature, type PropPos, type PropStat } from '../../lib/research/nfl-props';
import { playerWeeks, type PlayerWeek } from '../../lib/research/nflverse';

const fitSeason = Number(process.argv[2] ?? 2024);
const testSeason = Number(process.argv[3] ?? fitSeason + 1);

type Sample = { pos: PropPos; stat: PropStat; z: Record<Feature, number>; values: number[]; actual: number };

async function samples(season: number): Promise<Sample[]> {
  const [weeks, defGames] = await Promise.all([playerWeeks(season), nflDefenseGames(season)]);
  const reg = weeks.filter((w) => w.seasonType === 'REG');
  const byPlayer = new Map<string, PlayerWeek[]>();
  for (const w of reg) byPlayer.set(w.playerId, [...(byPlayer.get(w.playerId) ?? []), w]);
  for (const list of byPlayer.values()) list.sort((a, b) => a.week - b.week);
  const zByWeek = new Map<number, Map<string, Record<Feature, number>>>();
  for (let wk = 4; wk <= 18; wk++) {
    const prof = defenseProfiles(reg, defGames, wk);
    for (const [t, p] of prof) if (p.games < 3) prof.delete(t);
    zByWeek.set(wk, zScores(prof));
  }
  const out: Sample[] = [];
  for (const list of byPlayer.values()) {
    for (let i = 3; i < list.length; i++) {
      const w = list[i];
      const pos = posOf(w.position);
      const z = zByWeek.get(w.week)?.get(w.opponent);
      if (!pos || !z) continue;
      const prior = list.slice(0, i);
      for (const stat of POS_STATS[pos]) {
        const values = prior.map((p) => Number(p[STAT_COL[stat]] ?? 0));
        const b = baseline(values);
        if (b == null || b < minBase(pos, stat)) continue;
        out.push({ pos, stat, z, values, actual: Number(w[STAT_COL[stat]] ?? 0) });
      }
    }
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pearson = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < xs.length; i++) {
    a += (xs[i] - mx) * (ys[i] - my);
    b += (xs[i] - mx) ** 2;
    c += (ys[i] - my) ** 2;
  }
  return a / Math.sqrt(b * c);
};
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

const [fit, test] = await Promise.all([samples(fitSeason), samples(testSeason)]);
console.log(`Fit ${fitSeason}: ${fit.length} player-week props · test ${testSeason}: ${test.length}\n`);

// 1. Best baseline: how much weight on the last 3 games vs the season so far.
console.log('1. Baseline (test season, typical miss by recent-games weight 0 / 0.25 / 0.5 / 0.75 / 1)');
let bestW = 0.5;
{
  const ws = [0, 0.25, 0.5, 0.75, 1];
  const tot = ws.map(() => 0);
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as PropPos[]) {
    for (const stat of POS_STATS[pos]) {
      const s = test.filter((x) => x.pos === pos && x.stat === stat);
      if (!s.length) continue;
      const maes = ws.map((w) => mean(s.map((x) => Math.abs(x.actual - baseline(x.values, w)!))));
      // Normalized so stats of different scales add up comparably.
      maes.forEach((m, i) => (tot[i] += m / maes[2]));
      console.log(`   ${pos} ${stat.padEnd(10)} ${maes.map((m) => m.toFixed(2)).join(' / ')}  (n=${s.length})`);
    }
  }
  bestW = ws[tot.indexOf(Math.min(...tot))];
  console.log(`   → best recent weight overall: ${bestW}`);
}

// 2. Opponent effects: fit on one season, test on the next.
console.log(`\n2. Opponent run/pass defense effects (% change per +1 SD), fit ${fitSeason} → test ${testSeason}`);
const table: Record<string, Record<string, number[]>> = {};
for (const pos of ['QB', 'RB', 'WR', 'TE'] as PropPos[]) {
  table[pos] = {};
  for (const stat of POS_STATS[pos]) {
    const feats = PROP_FEATURES[pos][stat];
    if (!feats) continue;
    const tr = fit.filter((x) => x.pos === pos && x.stat === stat);
    const te = test.filter((x) => x.pos === pos && x.stat === stat);
    if (tr.length < 100 || !te.length) continue;
    const ratio = (x: Sample) => x.actual / baseline(x.values, bestW)! - 1;
    const coef = ols(tr.map((x) => feats.map((f) => x.z[f])), tr.map(ratio)).slice(1);
    const pred = (x: Sample) => baseline(x.values, bestW)! * (1 + coef.reduce((a, c, i) => a + c * x.z[feats[i]], 0));
    const base = mean(te.map((x) => Math.abs(x.actual - baseline(x.values, bestW)!)));
    const adj = mean(te.map((x) => Math.abs(x.actual - pred(x))));
    const r = pearson(te.map((x) => pred(x) - baseline(x.values, bestW)!), te.map((x) => x.actual - baseline(x.values, bestW)!));
    const helps = adj < base;
    table[pos][stat] = helps ? coef.map((c) => Math.round(c * 1000) / 1000) : coef.map(() => 0);
    console.log(
      `   ${pos} ${stat.padEnd(10)} ${feats.map((f, i) => `${f} ${(100 * coef[i]).toFixed(1)}%`).join(', ').padEnd(92)} ` +
        `miss ${base.toFixed(2)} → ${adj.toFixed(2)} (${(100 * (adj / base - 1)).toFixed(1)}%), r ${r.toFixed(2)}, n=${te.length}${helps ? '' : '  ✗ zeroed'}`,
    );
  }
}
console.log(`\nRECENT_WEIGHT = ${bestW}`);
console.log('PROP_EFFECTS =', JSON.stringify(table));

// 3. Outcome spread: actual / baseline, as quantiles. Built on the fit season and checked
//    on the test season: when the sheet says "over this line X% of the time", is it?
{
  const QS = Array.from({ length: 21 }, (_, i) => i / 20);
  const quantiles = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return QS.map((q) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]);
  };
  const probOver = (qs: number[], x: number) => {
    // share of the distribution at or above x, by linear interpolation between quantile points
    if (x <= qs[0]) return 1;
    if (x >= qs[qs.length - 1]) return 0;
    for (let i = 1; i < qs.length; i++) {
      if (x <= qs[i]) {
        const span = qs[i] - qs[i - 1];
        const f = span ? (x - qs[i - 1]) / span : 0;
        return 1 - (QS[i - 1] + f * (QS[i] - QS[i - 1]));
      }
    }
    return 0;
  };
  const out: Record<string, Record<string, number[]>> = {};
  const bins = Array.from({ length: 10 }, () => ({ n: 0, pred: 0, hit: 0 }));
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as PropPos[]) {
    out[pos] = {};
    for (const stat of POS_STATS[pos]) {
      const tr = fit.filter((x) => x.pos === pos && x.stat === stat);
      const te = test.filter((x) => x.pos === pos && x.stat === stat);
      if (tr.length < 100) continue;
      const qs = quantiles(tr.map((x) => x.actual / baseline(x.values, bestW)!));
      out[pos][stat] = qs.map((q) => Math.round(q * 1000) / 1000);
      for (const x of te) {
        const b = baseline(x.values, bestW)!;
        for (const m of [0.6, 0.8, 1, 1.2, 1.4]) {
          const line = Math.round(b * m) + 0.5; // a typical half-point prop line
          const p = probOver(qs, line / b);
          const bin = bins[Math.min(9, Math.floor(p * 10))];
          bin.n++;
          bin.pred += p;
          bin.hit += x.actual > line ? 1 : 0;
        }
      }
    }
  }
  console.log(`\n3. Calibration on ${testSeason} of "chance over the line" (spread built on ${fitSeason})`);
  for (const b of bins) if (b.n) console.log(`   said ${(100 * b.pred / b.n).toFixed(0).padStart(3)}% → happened ${(100 * b.hit / b.n).toFixed(0).padStart(3)}%  (n=${b.n})`);
  console.log('RATIO_QUANTILES =', JSON.stringify(out));
}
