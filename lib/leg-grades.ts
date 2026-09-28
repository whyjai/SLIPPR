import type { LegGradeLetter } from './leg-board';

/**
 * Grade labels and win-% floors. Kept apart from leg-board (which holds API
 * keys and the service-role client) so client components can import it.
 */
export const GRADE_META: Record<LegGradeLetter, { label: string; minWinPct: number; take: boolean }> = {
  'A+': { label: 'Elite take', minWinPct: 72, take: true },
  A: { label: 'Strong take', minWinPct: 64, take: true },
  'B+': { label: 'Solid take', minWinPct: 56, take: true },
  B: { label: 'Lean take', minWinPct: 48, take: true },
  C: { label: 'Fade', minWinPct: 0, take: false },
};
