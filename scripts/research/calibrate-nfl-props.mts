/**
 * Calibrate the NFL cheat sheet's outcome spread and "chance over" numbers on
 * history instead of one season. Walk-forward samples (each player-week uses
 * only that player's earlier games) for every season, then:
 *   A. current: one spread per (position, stat), from a single season
 *   B. pooled:  one spread per (position, stat), from all fit seasons
 *   C. pooled + volume buckets: spread per (position, stat, baseline tercile)
 *   D. B or C + a Platt correction curve fit on leave-one-season-out chances
 * Fit on 2021-2024, tested on 2025 and 2026. Prints the winning tables.
 *
 *   npx tsx scripts/research/calibrate-nfl-props.mts
 */
import { baseline, minBase, POS_STATS, posOf, RATIO_QUANTILES, STAT_COL, type PropPos, type PropStat } from '../../lib/research/nfl-props';
import { playerWeeks, type PlayerWeek } from '../../lib/research/nflverse';

const FIT = [2021, 2022, 2023, 2024];
const TEST = [2025, 2026];
const QS = Array.from({ length: 21 }, (_, i) => i / 20);

type Sample = { season: number; pos: PropPos; stat: PropStat; base: number; actual: number };

async function samples(season: number): Promise<Sample[]> {
  const weeks = (await playerWeeks(season)).filter((w) => w.seasonType === 'REG');
  const byPlayer = new Map<string, PlayerWeek[]>();
  for (const w of weeks) byPlayer.set(w.playerId, [...(byPlayer.get(w.playerId) ?? []), w]);
  const out: Sample[] = [];
  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.week - b.week);
    for (let i = 3; i < list.length; i++) {
      const pos = posOf(list[i].position);
      if (!pos || list[i].week < 4) continue;
      for (const stat of POS_STATS[pos]) {
        const base = baseline(list.slice(0, i).map((w) => Number(w[STAT_COL[stat]] ?? 0)));
        if (base == null || base < minBase(pos, stat)) continue;
        out.push({ season, pos, stat, base, actual: Number(list[i][STAT_COL[stat]] ?? 0) });
      }
    }
  }
  return out;
}

const quantiles = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return QS.map((q) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]);
};
const chance = (qs: number[], x: number) => {
  if (x <= qs[0]) return 1;
  if (x >= qs[qs.length - 1]) return 0;
  for (let i = 1; i < qs.length; i++) {
    if (x <= qs[i]) {
      const span = qs[i] - qs[i - 1];
      return 1 - (QS[i - 1] + (span ? (x - qs[i - 1]) / span : 0) * (QS[i] - QS[i - 1]));
    }
  }
  return 0;
};
const logit = (p: number) => Math.log(Math.min(0.995, Math.max(0.005, p)) / (1 - Math.min(0.995, Math.max(0.005, p))));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Volume terciles of the baseline, per (pos, stat), from the fit samples. */
function cutsFor(fit: Sample[]) {
  const cuts = new Map<string, [number, number]>();
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as PropPos[]) {
    for (const stat of POS_STATS[pos]) {
      const b = fit.filter((s) => s.pos === pos && s.stat === stat).map((s) => s.base).sort((x, y) => x - y);
      if (b.length) cuts.set(`${pos}|${stat}`, [b[Math.floor(b.length / 3)], b[Math.floor((2 * b.length) / 3)]]);
    }
  }
  return cuts;
}
const bucket = (cuts: Map<string, [number, number]>, s: { pos: PropPos; stat: PropStat; base: number }) => {
  const c = cuts.get(`${s.pos}|${s.stat}`);
  return !c ? 0 : s.base < c[0] ? 0 : s.base < c[1] ? 1 : 2;
};

type Model = (s: Sample, line: number) => number;

function spreadModel(fit: Sample[], byVolume: boolean): { model: Model; tables: Map<string, number[]>; cuts: Map<string, [number, number]> } {
  const cuts = cutsFor(fit);
  const groups = new Map<string, number[]>();
  for (const s of fit) {
    const key = `${s.pos}|${s.stat}${byVolume ? `|${bucket(cuts, s)}` : ''}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s.actual / s.base);
  }
  const tables = new Map([...groups].map(([k, v]) => [k, quantiles(v)]));
  return {
    tables,
    cuts,
    model: (s, line) => {
      const qs = tables.get(`${s.pos}|${s.stat}${byVolume ? `|${bucket(cuts, s)}` : ''}`);
      return qs ? chance(qs, line / s.base) : 0.5;
    },
  };
}

/** Typical half-point lines around each sample's baseline (as in the grader). */
const linesFor = (s: Sample) => [0.6, 0.8, 1, 1.2, 1.4].map((m) => Math.round(s.base * m) + 0.5);

function evaluate(name: string, test: Sample[], model: Model) {
  let brier = 0, n = 0;
  const bins = [[0, 0.3], [0.3, 0.45], [0.45, 0.55], [0.55, 0.7], [0.7, 1.01]].map(([lo, hi]) => ({ lo, hi, said: 0, hit: 0, n: 0 }));
  for (const s of test) {
    for (const line of linesFor(s)) {
      const p = model(s, line);
      const y = s.actual > line ? 1 : 0;
      brier += (p - y) ** 2;
      n++;
      const b = bins.find((x) => p >= x.lo && p < x.hi)!;
      b.said += p;
      b.hit += y;
      b.n++;
    }
  }
  console.log(`   ${name.padEnd(34)} Brier ${(brier / n).toFixed(4)} | ${bins.map((b) => `${Math.round((100 * b.said) / (b.n || 1))}→${Math.round((100 * b.hit) / (b.n || 1))}`).join('  ')}`);
  return brier / n;
}

/** Platt correction a·logit(p)+b, fit by gradient descent on leave-one-season-out chances. */
function fitPlatt(pairs: Array<[number, number]>): [number, number] {
  let a = 1, b = 0;
  for (let it = 0; it < 400; it++) {
    let ga = 0, gb = 0;
    for (const [p, y] of pairs) {
      const z = logit(p);
      const q = sigmoid(a * z + b);
      ga += (q - y) * z;
      gb += q - y;
    }
    a -= (0.5 * ga) / pairs.length;
    b -= (0.5 * gb) / pairs.length;
  }
  return [a, b];
}

// ---------------------------------------------------------------------------
const all = new Map<number, Sample[]>();
for (const season of [...FIT, ...TEST]) all.set(season, await samples(season));
const fit = FIT.flatMap((s) => all.get(s)!);
const test = TEST.flatMap((s) => all.get(s)!);
console.log(`Samples: fit ${FIT.join(',')} = ${fit.length} · test ${TEST.join(',')} = ${test.length}\n`);

const current: Model = (s, line) => {
  const qs = RATIO_QUANTILES[s.pos][s.stat];
  return qs ? chance(qs, line / s.base) : 0.5;
};
const pooled = spreadModel(fit, false);
const vol = spreadModel(fit, true);

// Leave-one-season-out chances on the fit seasons, for the correction curves.
const loso = (byVolume: boolean) => {
  const pairs: Array<[number, number]> = [];
  for (const season of FIT) {
    const m = spreadModel(FIT.filter((x) => x !== season).flatMap((x) => all.get(x)!), byVolume).model;
    for (const s of all.get(season)!) for (const line of linesFor(s)) pairs.push([m(s, line), s.actual > line ? 1 : 0]);
  }
  return fitPlatt(pairs);
};
const plattPooled = loso(false);
const plattVol = loso(true);

for (const [label, set] of [['Test 2025', all.get(2025)!], ['Test 2026 (weeks 4-6)', all.get(2026)!], ['Test both', test]] as const) {
  console.log(`${label} (said → happened by bin):`);
  evaluate('A current (2024 spread)', set, current);
  evaluate('B pooled 2021-24 spread', set, pooled.model);
  evaluate('C pooled + volume buckets', set, vol.model);
  evaluate(`D1 B + correction ${plattPooled.map((x) => x.toFixed(2))}`, set, (s, l) => sigmoid(plattPooled[0] * logit(pooled.model(s, l)) + plattPooled[1]));
  evaluate(`D2 C + correction ${plattVol.map((x) => x.toFixed(2))}`, set, (s, l) => sigmoid(plattVol[0] * logit(vol.model(s, l)) + plattVol[1]));
  console.log('');
}

// Tables for the library (pooled over every fit season, with volume buckets).
const round = (t: Map<string, number[]>) => Object.fromEntries([...t].map(([k, v]) => [k, v.map((x) => Math.round(x * 1000) / 1000)]));
console.log('POOLED =', JSON.stringify(round(pooled.tables)));
console.log('VOLUME =', JSON.stringify(round(vol.tables)));
console.log('CUTS =', JSON.stringify(Object.fromEntries([...vol.cuts].map(([k, v]) => [k, v.map((x) => Math.round(x * 10) / 10)]))));
console.log('PLATT_POOLED =', JSON.stringify(plattPooled.map((x) => Math.round(x * 1000) / 1000)), 'PLATT_VOLUME =', JSON.stringify(plattVol.map((x) => Math.round(x * 1000) / 1000)));

// Production tables: every completed season (fit + 2025), volume buckets (the winner above).
const prod = spreadModel([...fit, ...all.get(2025)!], true);
console.log('PROD_VOLUME =', JSON.stringify(round(prod.tables)));
console.log('PROD_CUTS =', JSON.stringify(Object.fromEntries([...prod.cuts].map(([k, v]) => [k, v.map((x) => Math.round(x * 10) / 10)]))));
