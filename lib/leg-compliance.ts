import type { CouncilLegVerdict } from './council';
import type { ScoutBrief } from './scout';
import type { BoardLeg, LegGradeLetter, MarketType, Sport } from './leg-board';

function americanToDecimal(odds: number): number {
  return odds < 0 ? 1 + 100 / -odds : 1 + odds / 100;
}

function evPerUnit(fairProbPct: number, americanOdds: number): number {
  const p = Math.min(1, Math.max(0, fairProbPct / 100));
  const dec = americanToDecimal(americanOdds);
  return p * (dec - 1) - (1 - p);
}

/** Informational-only disclaimer attached to API payloads and UI. */
export const COMPLIANCE_DISCLAIMER =
  'SLIPPR provides sports analytics and handicapping research for informational purposes only. ' +
  'We do not accept wagers, hold funds, or operate as a sportsbook. Past model performance does not ' +
  'guarantee future results. You are solely responsible for compliance with laws in your jurisdiction. ' +
  '21+. If you or someone you know has a gambling problem, call 1-800-GAMBLER.';

export type FadeAlert = {
  id: string;
  sport: Sport;
  market: MarketType;
  event: string;
  /** The side our models flag as overpriced or likely to fail. */
  pick: string;
  americanOdds: number;
  impliedProb: number;
  fairProb: number;
  /** Model confidence this side is a poor play (0–100). */
  fadeConfidence: number;
  thesis: string;
  category: 'public_trap' | 'juice_tax' | 'council_reject' | 'negative_ev' | 'scout_avoid';
  markers: string[];
};

export type LegRiskAssessment = {
  legId: string;
  avoid: boolean;
  avoidReasons: string[];
  fade: boolean;
  fadeConfidence: number;
  fadeCategory: FadeAlert['category'];
};

const AVOID_KEYWORDS =
  /\b(avoid|warning|trap|skip|fade|juice|correlat|public[- ]?heavy|do not|don't bet)\b/i;

/** Scout / copy markers that force exclusion from the published picks board. */
export function isAvoidMarker(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^avoid:/i.test(t) || /^warning:/i.test(t)) return true;
  return AVOID_KEYWORDS.test(t);
}

export function assessLegRisk(
  leg: BoardLeg,
  opts?: {
    scoutBrief?: ScoutBrief;
    councilVerdict?: CouncilLegVerdict;
    councilResponded?: number;
  },
): LegRiskAssessment {
  const avoidReasons: string[] = [];

  for (const flag of opts?.scoutBrief?.riskFlags ?? []) {
    if (isAvoidMarker(flag)) avoidReasons.push(`Scout: ${flag}`);
  }

  if (leg.americanOdds <= -150 && leg.edge <= -4) {
    avoidReasons.push(
      `Juice tax: ${leg.pick} at ${leg.americanOdds} is ${Math.abs(leg.edge)} pts worse than consensus`,
    );
  }

  if (leg.impliedProb >= 80 && leg.edge < -2) {
    avoidReasons.push('Public-heavy favorite priced well above fair value');
  }

  // The general value catch: the clearly-overpriced tail of the slate. This
  // populates Fade Alerts without eating the board (fair-value legs stay).
  const evPct = evPerUnit(leg.fairProb, leg.americanOdds) * 100;
  if (evPct < -2.8) {
    avoidReasons.push(`Clearly negative expected value (${evPct.toFixed(1)}% per unit)`);
  }

  // NOTE: council sentiment intentionally does NOT flag a leg as avoid. The
  // council approves sparingly by design, so treating non-endorsement as
  // "avoid" collapses the board. Council approvals drive ranking/grade instead;
  // a low-conviction leg is still a valid (lower) pick, not a fade.

  const avoid = avoidReasons.length > 0;

  let fadeCategory: FadeAlert['category'] = 'negative_ev';
  if (opts?.scoutBrief?.riskFlags.some(isAvoidMarker)) fadeCategory = 'scout_avoid';
  else if (leg.americanOdds <= -150 && leg.edge <= -4) fadeCategory = 'juice_tax';
  else if (leg.impliedProb >= 80 && leg.edge < -2) fadeCategory = 'public_trap';

  const fadeConfidence = Math.round(
    Math.min(
      92,
      Math.max(
        52,
        (avoid ? 18 : 0) +
          Math.max(0, -leg.edge) * 4 +
          Math.max(0, leg.impliedProb - leg.fairProb) * 1.2 +
          (opts?.scoutBrief?.riskFlags.filter(isAvoidMarker).length ?? 0) * 8,
      ),
    ),
  );

  // A leg is a fade only when it is genuinely avoid-flagged (value/warning), not
  // merely low-conviction.
  const fade = avoid;

  return {
    legId: leg.id,
    avoid,
    avoidReasons,
    fade,
    fadeConfidence,
    fadeCategory,
  };
}

export function toFadeAlert(leg: BoardLeg, assessment: LegRiskAssessment): FadeAlert {
  const thesis =
    assessment.avoidReasons[0] ??
    `Models price ${leg.pick} worse than the offered ${leg.impliedProb}% implied probability.`;

  return {
    id: `fade-${leg.id}`,
    sport: leg.sport,
    market: leg.market,
    event: leg.event,
    pick: leg.pick,
    americanOdds: leg.americanOdds,
    impliedProb: leg.impliedProb,
    fairProb: leg.fairProb,
    fadeConfidence: assessment.fadeConfidence,
    thesis,
    category: assessment.fadeCategory,
    markers: assessment.avoidReasons,
  };
}

/**
 * Published picks board: no avoid-flagged legs (they cannot receive grade C or
 * appear on the board). Fade candidates are routed to the separate Fade Alert
 * research section — never mixed with standard graded picks.
 */
export function partitionLegsForPublication(
  legs: BoardLeg[],
  assessments: Map<string, LegRiskAssessment>,
  gradeOf: (leg: BoardLeg) => LegGradeLetter,
): {
  picks: BoardLeg[];
  fadeAlerts: FadeAlert[];
  excludedAvoid: number;
} {
  const picks: BoardLeg[] = [];
  const fadeAlerts: FadeAlert[] = [];
  let excludedAvoid = 0;

  for (const leg of legs) {
    const assessment = assessments.get(leg.id) ?? assessLegRisk(leg);
    const grade = gradeOf(leg);

    // Only AVOID-flagged legs are pulled from the board (the compliance rule:
    // a warning/avoid marker can never be published as a graded pick). They
    // become Fade Alerts instead. Everything else — including ordinary grade-C
    // legs, which are simply lower-value plays — stays on the picks board.
    if (assessment.avoid) {
      excludedAvoid += 1;
      fadeAlerts.push(toFadeAlert(leg, assessment));
      continue;
    }

    picks.push({ ...leg, grade });
  }

  fadeAlerts.sort((a, b) => b.fadeConfidence - a.fadeConfidence);

  return {
    picks,
    fadeAlerts: fadeAlerts.slice(0, 10),
    excludedAvoid,
  };
}

/** Capacity guidance for 8 daily council sessions. */
export function capacityAdvisory(publishedPickCount: number, fadeCount: number): string {
  if (publishedPickCount >= 45) {
    return (
      `Publishing ${publishedPickCount} graded picks + ${fadeCount} fade alerts this session. ` +
      'At 8 sessions/day this exceeds 50 total research outputs while maintaining strict avoid filtering. ' +
      'Monitor council approval rates; if approvals drop below 60%, reduce BOARD_SIZE to 40.'
    );
  }
  if (publishedPickCount >= 35) {
    return (
      `${publishedPickCount} picks published. Target of 50+ daily research outputs (picks + fade alerts) ` +
      'is achievable at 8 sessions with current quality gates. Increase only if council approval stays ≥70%.'
    );
  }
  return (
    `${publishedPickCount} picks after filtering. Thin slate — quality over volume. ` +
    'Do not inflate BOARD_SIZE on low-line days; fade alerts supplement total research output.'
  );
}

export function councilSessionMeta(now = new Date()): {
  sessionIndex: number;
  sessionsPerDay: number;
  refreshWindow: string;
} {
  const sessionsPerDay = 8;
  const sessionIndex = Math.floor(now.getUTCHours() / 3) + 1;
  return {
    sessionIndex: Math.min(sessionIndex, sessionsPerDay),
    sessionsPerDay,
    refreshWindow: `Council session ${Math.min(sessionIndex, sessionsPerDay)}/${sessionsPerDay} · every 3h`,
  };
}
