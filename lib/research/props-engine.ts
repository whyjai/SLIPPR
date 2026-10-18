/**
 * Sport-agnostic pieces of the prop cheat sheets: a player's baseline from his
 * earlier games (optionally blended with last season early on), and the
 * calibrated spread of outcomes around it (quantiles of actual / baseline per
 * stat and volume tercile, fit on past seasons by each sport's calibrate script).
 */

export const QS = Array.from({ length: 21 }, (_, i) => i / 20);

export type SpreadModel = {
  /** `${group}|${stat}` → [low/mid cut, mid/high cut] on the baseline. */
  cuts: Record<string, number[]>;
  /** `${group}|${stat}|${tercile}` → 21 quantiles of actual / baseline. */
  tables: Record<string, number[]>;
};

export function spreadFor(model: SpreadModel, key: string, base: number): number[] | null {
  const c = model.cuts[key];
  if (!c) return null;
  const tercile = base < c[0] ? 0 : base < c[1] ? 1 : 2;
  return model.tables[`${key}|${tercile}`] ?? null;
}

/** Chance the stat finishes over `line` (0-1), given the baseline. */
export function chanceOver(model: SpreadModel, key: string, base: number, line: number): number | null {
  const qs = spreadFor(model, key, base);
  if (!qs || base <= 0) return null;
  const x = line / base;
  if (x <= qs[0]) return 1;
  if (x >= qs[qs.length - 1]) return 0;
  for (let i = 1; i < qs.length; i++) {
    if (x <= qs[i]) {
      const span = qs[i] - qs[i - 1];
      return 1 - (QS[i - 1] + (span ? (x - qs[i - 1]) / span : 0) * (QS[i] - QS[i - 1]));
    }
  }
  return 0;
}

/** Value at quantile q (0-1) of the outcome spread. */
export function outcomeAt(model: SpreadModel, key: string, base: number, q: number): number | null {
  const qs = spreadFor(model, key, base);
  return qs ? base * qs[Math.round(q * 20)] : null;
}

export type BaselineParams = {
  /** Weight on the last `recentN` games vs the season so far. */
  recentWeight: number;
  recentN: number;
  /** Last season's average counts like this many games (0 = ignore it). */
  priorGames: number;
  /** Fewest games (this season, or with a prior) before there's a baseline. */
  minGames: number;
};

/**
 * Baseline from this season's earlier games, shrunk toward last season's
 * average early on: (n·current + k·prior) / (n + k).
 */
export function blendBaseline(values: number[], prior: number | null, p: BaselineParams): number | null {
  const n = values.length;
  if (n === 0 && (prior == null || p.priorGames === 0)) return null;
  if (n < p.minGames && (prior == null || p.priorGames === 0)) return null;
  let current: number | null = null;
  if (n > 0) {
    const season = values.reduce((a, b) => a + b, 0) / n;
    const last = values.slice(-p.recentN);
    const recent = last.reduce((a, b) => a + b, 0) / last.length;
    current = (1 - p.recentWeight) * season + p.recentWeight * recent;
  }
  if (prior == null || p.priorGames === 0) return current;
  if (current == null) return prior;
  return (n * current + p.priorGames * prior) / (n + p.priorGames);
}

/** Build a spread model from (key, base, actual) samples. */
export function buildSpread(samples: Array<{ key: string; base: number; actual: number }>): SpreadModel {
  const byKey = new Map<string, number[]>();
  for (const s of samples) (byKey.get(s.key) ?? byKey.set(s.key, []).get(s.key)!).push(s.base);
  const cuts: Record<string, number[]> = {};
  for (const [k, bases] of byKey) {
    const b = [...bases].sort((x, y) => x - y);
    cuts[k] = [b[Math.floor(b.length / 3)], b[Math.floor((2 * b.length) / 3)]];
  }
  const groups = new Map<string, number[]>();
  for (const s of samples) {
    const c = cuts[s.key];
    const t = s.base < c[0] ? 0 : s.base < c[1] ? 1 : 2;
    const g = `${s.key}|${t}`;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(s.actual / s.base);
  }
  const tables: Record<string, number[]> = {};
  for (const [g, ratios] of groups) {
    const r = [...ratios].sort((x, y) => x - y);
    tables[g] = QS.map((q) => Math.round(r[Math.min(r.length - 1, Math.floor(q * (r.length - 1)))] * 1000) / 1000);
  }
  return { cuts, tables };
}

/** Score a model on (key, base, actual) samples at typical half-point lines around the baseline. */
export function scoreSpread(model: SpreadModel, samples: Array<{ key: string; base: number; actual: number }>) {
  let brier = 0, n = 0, overMedian = 0, inside = 0;
  const bins = [[0, 0.3], [0.3, 0.45], [0.45, 0.55], [0.55, 0.7], [0.7, 1.01]].map(([lo, hi]) => ({ lo, hi, said: 0, hit: 0, n: 0 }));
  for (const s of samples) {
    const med = outcomeAt(model, s.key, s.base, 0.5) ?? s.base;
    const lo = outcomeAt(model, s.key, s.base, 0.25) ?? s.base;
    const hi = outcomeAt(model, s.key, s.base, 0.75) ?? s.base;
    if (s.actual > med) overMedian++;
    if (s.actual >= lo && s.actual <= hi) inside++;
    for (const m of [0.6, 0.8, 1, 1.2, 1.4]) {
      const line = Math.round(s.base * m) + 0.5;
      const p = chanceOver(model, s.key, s.base, line) ?? 0.5;
      const y = s.actual > line ? 1 : 0;
      brier += (p - y) ** 2;
      n++;
      const b = bins.find((x) => p >= x.lo && p < x.hi)!;
      b.said += p;
      b.hit += y;
      b.n++;
    }
  }
  return {
    brier: brier / (n || 1),
    overMedian: overMedian / (samples.length || 1),
    insideMiddle50: inside / (samples.length || 1),
    bins: bins.map((b) => `${Math.round((100 * b.said) / (b.n || 1))}→${Math.round((100 * b.hit) / (b.n || 1))}`).join('  '),
  };
}
