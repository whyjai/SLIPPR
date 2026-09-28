// Pure odds conversions, safe to import from client components.

/** Fair probability → American odds, rounded to the nearest 5. */
export function impliedToAmerican(p: number): number {
  const raw = p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p;
  return Math.round(raw / 5) * 5;
}

export function americanToDecimal(odds: number): number {
  return odds < 0 ? 1 + 100 / -odds : 1 + odds / 100;
}
