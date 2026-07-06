import {
  americanToDecimal,
  impliedToAmerican,
  type BoardLeg,
  type MarketType,
  type Sport,
} from './leg-board';

export type RiskProfile = 'safe' | 'balanced' | 'aggressive';

export type SlipParams = {
  targetMultiplier: number; // e.g. 5 => +400
  maxLegs: number;
  minConfidence: number;
  sports: Sport[] | null; // null = all
  markets: MarketType[] | null; // null = all
  allowSameEvent: boolean;
  riskProfile: RiskProfile;
};

export type SlipGradeLetter = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';

export type BuiltSlip = {
  legs: BoardLeg[];
  decimalOdds: number;
  americanOdds: string;
  jointFairProb: number; // 0-100
  expectedValue: number; // per $1 staked
  grade: SlipGradeLetter;
  kellyStakePct: number; // % of bankroll, quarter-Kelly
  warnings: string[];
};

export const MULTIPLIER_PRESETS = [2, 3, 5, 10, 25, 50] as const;

function legScore(leg: BoardLeg, profile: RiskProfile): number {
  switch (profile) {
    case 'safe':
      return leg.fairProb * 2 + leg.confidence;
    case 'aggressive':
      return leg.edge * 10 + americanToDecimal(leg.americanOdds) * 5 + leg.confidence;
    case 'balanced':
    default:
      return leg.confidence + leg.edge * 3 + leg.fairProb;
  }
}

function slipGrade(ev: number, jointFairProb: number): SlipGradeLetter {
  if (ev >= 0.15 && jointFairProb >= 15) return 'A+';
  if (ev >= 0.08) return 'A';
  if (ev >= 0.02) return 'B+';
  if (ev >= -0.04) return 'B';
  if (ev >= -0.12) return 'C';
  return 'D';
}

function quarterKelly(decimalOdds: number, p: number): number {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const kelly = (b * p - (1 - p)) / b;
  return Math.max(0, Math.round(kelly * 25 * 10) / 10); // quarter-Kelly, as %
}

export function filterPool(legs: BoardLeg[], params: SlipParams): BoardLeg[] {
  return legs.filter(
    (leg) =>
      leg.confidence >= params.minConfidence &&
      (!params.sports || params.sports.includes(leg.sport)) &&
      (!params.markets || params.markets.includes(leg.market)),
  );
}

/**
 * Greedy target-seeking construction: for each candidate leg count n, aim for
 * per-leg decimal odds of target^(1/n), pick the highest-scoring legs near
 * that band, and keep the combination with the best joint fair probability
 * that still reaches ~90% of the target multiplier.
 */
export function buildSlip(allLegs: BoardLeg[], params: SlipParams): BuiltSlip | null {
  const pool = filterPool(allLegs, params).sort(
    (a, b) => legScore(b, params.riskProfile) - legScore(a, params.riskProfile),
  );
  if (pool.length < 2) return null;

  let best: { legs: BoardLeg[]; decimal: number; joint: number } | null = null;

  for (let n = 2; n <= params.maxLegs; n++) {
    const perLegTarget = Math.pow(params.targetMultiplier, 1 / n);
    const chosen: BoardLeg[] = [];
    const usedEvents = new Set<string>();
    let decimal = 1;
    let joint = 1;

    // Prefer legs whose price sits near the per-leg target so the slip lands
    // on the requested multiplier with the fewest low-probability legs.
    const ranked = [...pool].sort((a, b) => {
      const da = Math.abs(americanToDecimal(a.americanOdds) - perLegTarget);
      const db = Math.abs(americanToDecimal(b.americanOdds) - perLegTarget);
      return (
        da - db ||
        legScore(b, params.riskProfile) - legScore(a, params.riskProfile)
      );
    });

    for (const leg of ranked) {
      if (chosen.length >= n) break;
      if (!params.allowSameEvent && usedEvents.has(leg.event)) continue;
      chosen.push(leg);
      usedEvents.add(leg.event);
      decimal *= americanToDecimal(leg.americanOdds);
      joint *= leg.fairProb / 100;
    }

    if (chosen.length < 2 || decimal < params.targetMultiplier * 0.9) continue;
    if (!best || joint > best.joint) {
      best = { legs: chosen, decimal, joint };
    }
  }

  // Nothing reached the target — return the highest-paying slip we can make.
  if (!best) {
    const chosen: BoardLeg[] = [];
    const usedEvents = new Set<string>();
    let decimal = 1;
    let joint = 1;

    const byPayout = [...pool].sort(
      (a, b) => americanToDecimal(b.americanOdds) - americanToDecimal(a.americanOdds),
    );
    for (const leg of byPayout) {
      if (chosen.length >= params.maxLegs) break;
      if (!params.allowSameEvent && usedEvents.has(leg.event)) continue;
      chosen.push(leg);
      usedEvents.add(leg.event);
      decimal *= americanToDecimal(leg.americanOdds);
      joint *= leg.fairProb / 100;
    }
    if (chosen.length < 2) return null;
    best = { legs: chosen, decimal, joint };
  }

  const ev = best.joint * best.decimal - 1;
  const warnings: string[] = [];

  const eventCounts = new Map<string, number>();
  best.legs.forEach((l) => eventCounts.set(l.event, (eventCounts.get(l.event) ?? 0) + 1));
  if ([...eventCounts.values()].some((c) => c > 1)) {
    warnings.push(
      'Slip contains correlated legs from the same event — books reprice these, and true probability may differ from the independent estimate.',
    );
  }
  if (best.decimal < params.targetMultiplier * 0.98) {
    warnings.push(
      `Board could not reach ${params.targetMultiplier}x within your filters — best available is ${best.decimal.toFixed(2)}x. Loosen min confidence or add sports.`,
    );
  }
  if (best.joint < 0.08) {
    warnings.push('Longshot territory: under 8% joint probability. Size accordingly.');
  }
  if (ev < 0) {
    warnings.push('Council prices this slip below break-even at current odds.');
  }

  const totalDecimal = best.decimal;
  const impliedTotal = 1 / totalDecimal;
  const american =
    totalDecimal >= 2
      ? `+${Math.round((totalDecimal - 1) * 100)}`
      : `${impliedToAmerican(impliedTotal)}`;

  return {
    legs: best.legs,
    decimalOdds: Math.round(totalDecimal * 100) / 100,
    americanOdds: american,
    jointFairProb: Math.round(best.joint * 1000) / 10,
    expectedValue: Math.round(ev * 1000) / 1000,
    grade: slipGrade(ev, best.joint * 100),
    kellyStakePct: quarterKelly(totalDecimal, best.joint),
    warnings,
  };
}
