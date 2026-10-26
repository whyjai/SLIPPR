/**
 * Which NFL board rows (scripts/research/nfl-board.mts) make the cheat sheet, shared by the
 * graphic and the tracked cards so both always agree.
 *  - confirmed: positive EV at the best price, no failed check, 4+ passed, model not far from the
 *    market, game not started, 3+ games this season (no debuts), one prop per player
 *  - best bets: the 3 confirmed plays with the highest EV, one per game (outcomes in the same game move together)
 */

export type BoardRow = {
  game: string;
  kickoff: string;
  player: string;
  flagged: boolean;
  fails: number;
  passes: number;
  best: { book: string; price: number; ev: number } | null;
  why?: { games: number };
  [k: string]: unknown;
};

export const CONFIRMED_MAX = 10;
export const BEST_BETS = 3;

export function nflTiers<R extends BoardRow>(rows: R[], now = Date.now()) {
  const seen = new Set<string>();
  const confirmed = [...rows]
    .filter((r) => !r.flagged && r.best && r.best.ev > 0 && r.fails === 0 && r.passes >= 4 && Date.parse(r.kickoff) > now && (r.why?.games ?? 0) >= 3)
    .sort((a, b) => b.best!.ev - a.best!.ev)
    .filter((r) => !seen.has(r.player) && seen.add(r.player))
    .slice(0, CONFIRMED_MAX);
  const games = new Set<string>();
  const best = confirmed.filter((r) => !games.has(r.game) && games.add(r.game)).slice(0, BEST_BETS);
  return { confirmed, best };
}
