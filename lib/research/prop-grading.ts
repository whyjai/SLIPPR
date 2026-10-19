/** Shared scoring for every sport's prop cheat sheet track record. */

export type GradedProp = {
  key: string; // e.g. "nba|pts"
  name: string;
  base: number;
  median: number;
  low: number;
  high: number;
  actual: number;
  lines: Array<{ line: number; chance: number; hits: number; games: number; over: boolean }>;
};

export type TrackSummary = {
  props: number;
  lines: number;
  overMedian: number | null;
  underAverage: number | null;
  insideMiddle50: number | null;
  brier: { sheet: number | null; ownHitRate: number | null; coinFlip: number | null };
  calibration: Array<{ from: number; to: number; said: number | null; happened: number | null; n: number }>;
};

export function summarize(graded: GradedProp[]): TrackSummary {
  const lines = graded.flatMap((g) => g.lines);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const share = (n: number, d: number) => (d ? r3(n / d) : null);
  const brier = (p: (l: (typeof lines)[number]) => number) =>
    lines.length ? r3(lines.reduce((s, l) => s + (p(l) - (l.over ? 1 : 0)) ** 2, 0) / lines.length) : null;
  return {
    props: graded.length,
    lines: lines.length,
    overMedian: share(graded.filter((g) => g.actual > g.median).length, graded.length),
    underAverage: share(graded.filter((g) => g.actual < g.base).length, graded.length),
    insideMiddle50: share(graded.filter((g) => g.actual >= g.low && g.actual <= g.high).length, graded.length),
    brier: { sheet: brier((l) => l.chance / 100), ownHitRate: brier((l) => (l.games ? l.hits / l.games : 0.5)), coinFlip: brier(() => 0.5) },
    calibration: [[0, 30], [30, 45], [45, 55], [55, 70], [70, 101]].map(([lo, hi]) => {
      const b = lines.filter((l) => l.chance >= lo && l.chance < hi);
      return {
        from: lo,
        to: Math.min(hi, 100),
        said: b.length ? Math.round(b.reduce((s, l) => s + l.chance, 0) / b.length) : null,
        happened: share(b.filter((l) => l.over).length, b.length),
        n: b.length,
      };
    }),
  };
}

export function printSummary(label: string, s: TrackSummary, pending = 0, dnp = 0) {
  const p = (x: number | null) => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);
  console.log(`\n=== ${label}: ${s.props} props (${s.lines} lines) · ${pending} pending · ${dnp} DNP`);
  if (!s.props) return;
  console.log(`   over median ${p(s.overMedian)} · inside middle 50% ${p(s.insideMiddle50)} · under baseline ${p(s.underAverage)}`);
  console.log(`   Brier: sheet ${s.brier.sheet} · own hit rate ${s.brier.ownHitRate} · coin ${s.brier.coinFlip}`);
  console.log(`   said → happened: ${s.calibration.filter((c) => c.n).map((c) => `${c.said}→${c.happened == null ? '—' : Math.round(100 * c.happened)} (${c.n})`).join('  ')}`);
}
