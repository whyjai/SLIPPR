import axios from 'axios';
import { getSupabaseAdmin } from './supabase-admin';
import { boardDayKey, filterLegsForToday, isOnTodaysSlate } from './slate';

/**
 * Prop Edges: compares DFS pick'em + soft-book player props against devigged
 * sharp sportsbook prices and ranks where each play should be taken.
 *
 * Sharp side  — Pinnacle-weighted no-vig consensus (power devig per book).
 * Target side — PrizePicks, Underdog, DK Pick6, Betr, Fliff (+ optional extras).
 *
 * Edge = sharp win probability − the platform's per-pick breakeven. Pick'em apps
 * with flat payouts use their best standard entry breakeven; anything priced
 * individually (Fliff odds, goblins/demons, multiplier picks) uses its price.
 *
 * Data: The Odds API per-event odds endpoint. Props are billed per market per
 * 10-book group per event, so this scan is opt-in (PROP_SCAN=on), capped by
 * PROPS_MAX_EVENTS, and cached on its own cadence (PROPS_SCAN_HOURS).
 *
 * Fallback: when the Odds API is off, unconfigured, or out of credits, we read
 * Pinnacle's public guest feed (free). It has sharp prices but no pick'em
 * lines, so those plays are "sharp-only": ranked against the best pick'em
 * breakeven, with the app line marked unverified.
 */

export type PropSide = 'over' | 'under';

export type PropEdge = {
  id: string;
  sport: string;
  event: string;
  startTime: string;
  player: string;
  market: string; // human label, e.g. "Pass Yds"
  side: PropSide;
  line: number;
  platform: string; // where to take it
  price: number | null; // American odds as posted (null/flat on standard pick'em)
  winProb: number; // sharp no-vig probability the pick hits, %
  fairOdds: number; // winProb as American odds
  breakeven: number; // % needed on this platform
  breakevenBasis: 'entry' | 'price';
  edge: number; // winProb − breakeven, in points
  lineMatch: 'exact' | 'estimated' | 'unverified'; // unverified = sharp-only, app line not seen
  sharpLines: Array<{ book: string; line: number; overProb: number }>;
};

export type PropEdgesResult = {
  generatedAt: string;
  source: 'live' | 'sharp-only' | 'disabled' | 'unconfigured' | 'empty';
  message?: string;
  platformsSeen: string[];
  sharpBooksSeen: string[];
  edges: PropEdge[];
  breakevens: Record<string, number | null>;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SPORT_MARKETS: Record<string, { label: string; markets: string[] }> = {
  americanfootball_nfl: {
    label: 'NFL',
    markets: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions', 'player_pass_tds'],
  },
  americanfootball_ncaaf: {
    label: 'NCAAF',
    markets: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds'],
  },
  basketball_nba: {
    label: 'NBA',
    markets: ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists'],
  },
  basketball_wnba: {
    label: 'WNBA',
    markets: ['player_points', 'player_rebounds', 'player_assists', 'player_threes'],
  },
  baseball_mlb: {
    label: 'MLB',
    markets: ['pitcher_strikeouts', 'pitcher_outs', 'batter_total_bases', 'batter_hits_runs_rbis', 'batter_hits'],
  },
  icehockey_nhl: {
    label: 'NHL',
    markets: ['player_shots_on_goal', 'player_points', 'player_total_saves'],
  },
};

/** Trust weight in the consensus fair price. */
const SHARP_BOOKS: Record<string, number> = {
  pinnacle: 3,
  betonlineag: 1.5,
  fanduel: 1.5,
  draftkings: 1,
  betmgm: 0.5,
};

/**
 * Per-pick breakeven on each platform's best standard entry (approximate —
 * payout tables change). null = priced like a sportsbook, use the odds.
 */
export const PLATFORMS: Record<string, { name: string; breakeven: number | null }> = {
  prizepicks: { name: 'PrizePicks', breakeven: 0.542 }, // 5/6-pick Flex
  underdog: { name: 'Underdog', breakeven: 0.543 }, // 5-pick Flex / 3-pick 6x
  pick6: { name: 'DK Pick6', breakeven: 0.562 },
  betr_us_dfs: { name: 'Betr', breakeven: 0.577 },
  fliff: { name: 'Fliff', breakeven: null },
  // Enable via PROPS_EXTRA_BOOKS if your Odds API plan carries them.
  dabble: { name: 'Dabble', breakeven: 0.577 },
  sleeper: { name: 'Sleeper', breakeven: 0.577 },
};

const DEFAULT_TARGETS = ['prizepicks', 'underdog', 'pick6', 'betr_us_dfs', 'fliff'];

// Standard pick'em picks come through with a near-even placeholder price.
const FLAT_PRICE_MIN = -140;
const FLAT_PRICE_MAX = 105;

// Matches the "only stack 3%+" guidance shown on the page itself — a pick
// this app surfaces should already clear the bar it tells users to apply,
// not rely on them reading a caveat to filter out the rest.
const MIN_EDGE = 3; // points; below this isn't worth listing
const MAX_EDGES = 150;
const MAX_ESTIMATED_GAP = 0.2; // skip line mismatches >20% — model gets unreliable

function scanEnabled(): boolean {
  return /^(on|1|true|yes)$/i.test(process.env.PROP_SCAN ?? '');
}

export function targetBooks(): string[] {
  const extras = (process.env.PROPS_EXTRA_BOOKS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && PLATFORMS[s]);
  return [...new Set([...DEFAULT_TARGETS, ...extras])];
}

// ---------------------------------------------------------------------------
// Probability math
// ---------------------------------------------------------------------------

export function americanToProb(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export function probToAmerican(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return Math.round(p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p);
}

/** Power devig: solve over^k + under^k = 1; corrects favorite/longshot bias better than proportional. */
function devigOver(pOver: number, pUnder: number): number {
  let lo = 0.5;
  let hi = 3;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    if (pOver ** k + pUnder ** k > 1) lo = k;
    else hi = k;
  }
  return pOver ** ((lo + hi) / 2);
}

function poissonCdf(k: number, lam: number): number {
  let sum = 0;
  let term = Math.exp(-lam);
  for (let i = 0; i <= k; i++) {
    if (i > 0) term *= lam / i;
    sum += term;
  }
  return sum;
}

function fitPoisson(line: number, pOver: number): number {
  let lo = 1e-4;
  let hi = Math.max(4 * line + 10, 20);
  for (let i = 0; i < 80; i++) {
    const lam = (lo + hi) / 2;
    if (1 - poissonCdf(Math.floor(line), lam) < pOver) lo = lam;
    else hi = lam;
  }
  return (lo + hi) / 2;
}

function normCdf(x: number): number {
  // Abramowitz–Stegun erf approximation (max error ~1.5e-7)
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function normPpf(p: number): number {
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (normCdf(m) < p) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * How widely each stat swings, as sd / median. Measured from the books' own
 * alternate-line ladders (DraftKings/FanDuel, 95 points / 66 rebounds / 64
 * assists / 72 threes / 52 strikeout / 41 hits / 82 total-bases ladders,
 * 2026-09-22): fitting a normal to each ladder gives the spread the market
 * itself prices. NFL yardage has no cached ladders; its 0.6 is fit to the
 * five-book consensus at neighboring lines on 2026-09-24 (6 props, errors
 * within ~3 pts, on the conservative side). Pass yards is an uncalibrated
 * typical value. Keys cover both Odds API market keys and Pinnacle labels.
 */
const SPREAD_RATIO: Record<string, number> = {
  player_points: 0.45,
  Points: 0.45,
  player_rebounds: 0.52,
  Rebounds: 0.52,
  player_assists: 0.57,
  Assists: 0.57,
  player_threes: 0.94,
  'Threes Made': 0.94,
  player_points_rebounds_assists: 0.4, // a sum of partly offsetting parts: tighter than each alone
  'Pts & Rebs & Asts': 0.4,
  pitcher_strikeouts: 0.46,
  Strikeouts: 0.46,
  batter_hits: 1.0,
  Hits: 1.0,
  batter_total_bases: 2.2,
  'Total Bases': 2.2,
  player_rush_yds: 0.6,
  'Rushing Yards': 0.6,
  player_reception_yds: 0.6,
  'Receiving Yards': 0.6,
  player_receptions: 0.5,
  Receptions: 0.5,
  player_pass_yds: 0.25,
  'Passing Yards': 0.25,
};

/**
 * Estimate P(over targetLine) from fair P(over sharpLine). Normal with a
 * market-calibrated spread when we have one; the old line-size heuristic
 * (Poisson under 12, normal 0.3 above) only for uncalibrated markets.
 *
 * Solving P(X > L) = pOver for the mean: (L − μ)/sd = Φ⁻¹(1 − pOver), so
 * μ = L − sd·Φ⁻¹(1 − pOver). (An earlier version added that term instead of
 * subtracting it, which mirrored the lean — a 70% Over at 20 came out 27% at
 * 20.5 — on every normal-branch shift.)
 */
function shiftOverProb(pOver: number, sharpLine: number, targetLine: number, market?: string): number {
  if (sharpLine === targetLine) return pOver;
  const ratio = market ? SPREAD_RATIO[market] : undefined;
  if (ratio == null && sharpLine < 12) {
    const lam = fitPoisson(sharpLine, pOver);
    return 1 - poissonCdf(Math.floor(targetLine), lam);
  }
  const sd = ratio != null ? Math.max(ratio * sharpLine, 1) : Math.max(0.3 * sharpLine, 3);
  const mean = sharpLine - sd * normPpf(1 - pOver);
  return 1 - normCdf((targetLine - mean) / sd);
}

// ---------------------------------------------------------------------------
// Odds API
// ---------------------------------------------------------------------------

type OddsOutcome = { name: string; description?: string; price: number; point?: number };
type OddsEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: Array<{ key: string; title: string; markets: Array<{ key: string; outcomes: OddsOutcome[] }> }>;
};

type SharpQuote = { book: string; line: number; overProb: number };
type TargetQuote = { book: string; line: number; side: PropSide; price: number | null };

const ODDS_API = 'https://api.the-odds-api.com/v4';

const MARKET_LABELS: Record<string, string> = {
  player_pass_yds: 'Pass Yds',
  player_pass_tds: 'Pass TDs',
  player_rush_yds: 'Rush Yds',
  player_reception_yds: 'Rec Yds',
  player_receptions: 'Receptions',
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: '3PM',
  player_points_rebounds_assists: 'PRA',
  pitcher_strikeouts: 'Strikeouts',
  pitcher_outs: 'Pitching Outs',
  batter_total_bases: 'Total Bases',
  batter_hits_runs_rbis: 'H+R+RBI',
  batter_hits: 'Hits',
  player_shots_on_goal: 'Shots on Goal',
  player_total_saves: 'Saves',
};

function marketLabel(key: string): string {
  return MARKET_LABELS[key] ?? key.replace(/^(player|batter|pitcher)_/, '').replace(/_/g, ' ');
}

function collectQuotes(event: OddsEvent, markets: string[]) {
  const props = new Map<string, { player: string; market: string; sharp: SharpQuote[]; targets: TargetQuote[] }>();

  for (const bm of event.bookmakers ?? []) {
    const isSharp = bm.key in SHARP_BOOKS;
    const isTarget = bm.key in PLATFORMS;
    if (!isSharp && !isTarget) continue;

    for (const mk of bm.markets) {
      if (!markets.includes(mk.key)) continue;

      const byLine = new Map<string, { player: string; line: number; over?: number; under?: number }>();
      for (const o of mk.outcomes) {
        const side = o.name.toLowerCase();
        const player = o.description ?? '';
        if (!player || o.point == null || (side !== 'over' && side !== 'under')) continue;
        const k = `${player}|${o.point}`;
        const row = byLine.get(k) ?? { player, line: o.point };
        row[side] = o.price;
        byLine.set(k, row);
      }

      for (const row of byLine.values()) {
        const pk = `${row.player}|${mk.key}`;
        const entry = props.get(pk) ?? { player: row.player, market: mk.key, sharp: [], targets: [] };

        if (isSharp && row.over != null && row.under != null) {
          entry.sharp.push({
            book: bm.key,
            line: row.line,
            overProb: devigOver(americanToProb(row.over), americanToProb(row.under)),
          });
        } else if (isTarget) {
          if (row.over != null) entry.targets.push({ book: bm.key, line: row.line, side: 'over', price: row.over });
          if (row.under != null) entry.targets.push({ book: bm.key, line: row.line, side: 'under', price: row.under });
        }
        props.set(pk, entry);
      }
    }
  }
  return props;
}

// ---------------------------------------------------------------------------
// Game lines: moneyline + game total. Fliff-only — it's the one target app
// here that's a real sportsbook (PrizePicks/Underdog/Pick6/Betr don't carry
// these markets at all). The Leg Board already prices moneyline/spread/total
// edges against mainstream sportsbooks (FanDuel, DraftKings, BetMGM, ...) but
// explicitly excludes Fliff from that scan, so this is genuinely new
// coverage, not a duplicate: does Fliff's own price beat the sharp consensus.
// ---------------------------------------------------------------------------

const GAME_MARKETS = ['h2h', 'totals'];

/** Weighted-devig fair win probability for the home team, from sharp books
 *  that post both sides of the moneyline. */
function fairHomeWinProb(event: OddsEvent): { p: number; books: Array<{ book: string; p: number }> } | null {
  let num = 0;
  let den = 0;
  const books: Array<{ book: string; p: number }> = [];
  for (const bm of event.bookmakers ?? []) {
    if (!(bm.key in SHARP_BOOKS)) continue;
    const h2h = bm.markets.find((m) => m.key === 'h2h');
    const home = h2h?.outcomes.find((o) => o.name === event.home_team);
    const away = h2h?.outcomes.find((o) => o.name === event.away_team);
    if (!home || !away) continue;
    const w = SHARP_BOOKS[bm.key];
    const p = devigOver(americanToProb(home.price), americanToProb(away.price));
    num += w * p;
    den += w;
    books.push({ book: bm.key, p });
  }
  return den > 0 ? { p: num / den, books } : null;
}

/** Same idea for the game total: fair P(Over point), from sharp books posting
 *  both sides at that exact point (a point mismatch is skipped, not shifted —
 *  game totals move in smaller, less predictable steps than player lines, so
 *  the Poisson/normal shift used for props isn't a safe stand-in here). */
function fairTotalOverProb(event: OddsEvent, point: number): { p: number; books: Array<{ book: string; p: number }> } | null {
  let num = 0;
  let den = 0;
  const books: Array<{ book: string; p: number }> = [];
  for (const bm of event.bookmakers ?? []) {
    if (!(bm.key in SHARP_BOOKS)) continue;
    const totals = bm.markets.find((m) => m.key === 'totals');
    const over = totals?.outcomes.find((o) => o.name === 'Over' && o.point === point);
    const under = totals?.outcomes.find((o) => o.name === 'Under' && o.point === point);
    if (!over || !under) continue;
    const w = SHARP_BOOKS[bm.key];
    const p = devigOver(americanToProb(over.price), americanToProb(under.price));
    num += w * p;
    den += w;
    books.push({ book: bm.key, p });
  }
  return den > 0 ? { p: num / den, books } : null;
}

/** Fliff's moneyline + game-total edges for one event, in the PropEdge shape
 *  so they render in the same list as player props. `player` holds the team
 *  name (moneyline) or is blank (game total, which has no player); `side` is
 *  fixed 'over' for moneyline (there's no "under a team winning") and the
 *  real over/under for totals. */
function collectGameLines(event: OddsEvent, sport: string): PropEdge[] {
  const fliff = event.bookmakers?.find((b) => b.key === 'fliff');
  if (!fliff) return [];
  const edges: PropEdge[] = [];
  const gameLabel = `${event.away_team} @ ${event.home_team}`;

  const home = fairHomeWinProb(event);
  if (home != null) {
    const h2h = fliff.markets.find((m) => m.key === 'h2h');
    const sides: Array<{ team: string; p: number; sharpLines: PropEdge['sharpLines'] }> = [
      { team: event.home_team, p: home.p, sharpLines: home.books.map((b) => ({ book: b.book, line: 0, overProb: round1(b.p * 100) })) },
      {
        team: event.away_team,
        p: 1 - home.p,
        sharpLines: home.books.map((b) => ({ book: b.book, line: 0, overProb: round1((1 - b.p) * 100) })),
      },
    ];
    for (const { team, p, sharpLines } of sides) {
      const price = h2h?.outcomes.find((o) => o.name === team)?.price;
      if (price == null) continue;
      const be = americanToProb(price);
      const edge = (p - be) * 100;
      if (edge < MIN_EDGE) continue;
      edges.push({
        id: `${event.id}-h2h-${team}`.replace(/[^a-zA-Z0-9.-]/g, ''),
        sport,
        event: gameLabel,
        startTime: event.commence_time,
        player: team,
        market: 'Moneyline',
        side: 'over',
        line: 0,
        platform: PLATFORMS.fliff.name,
        price,
        winProb: round1(p * 100),
        fairOdds: probToAmerican(p),
        breakeven: round1(be * 100),
        breakevenBasis: 'price',
        edge: round1(edge),
        lineMatch: 'exact',
        sharpLines,
      });
    }
  }

  const totals = fliff.markets.find((m) => m.key === 'totals');
  for (const o of totals?.outcomes ?? []) {
    if (o.point == null || (o.name !== 'Over' && o.name !== 'Under')) continue;
    const total = fairTotalOverProb(event, o.point);
    if (total == null) continue;
    const p = o.name === 'Over' ? total.p : 1 - total.p;
    const be = americanToProb(o.price);
    const edge = (p - be) * 100;
    if (edge < MIN_EDGE) continue;
    edges.push({
      id: `${event.id}-total-${o.name}-${o.point}`.replace(/[^a-zA-Z0-9.-]/g, ''),
      sport,
      event: gameLabel,
      startTime: event.commence_time,
      player: '',
      market: 'Game Total',
      side: o.name === 'Over' ? 'over' : 'under',
      line: o.point,
      platform: PLATFORMS.fliff.name,
      price: o.price,
      winProb: round1(p * 100),
      fairOdds: probToAmerican(p),
      breakeven: round1(be * 100),
      breakevenBasis: 'price',
      edge: round1(edge),
      lineMatch: 'exact',
      sharpLines: total.books.map((b) => ({
        book: b.book,
        line: o.point!,
        overProb: round1((o.name === 'Over' ? b.p : 1 - b.p) * 100),
      })),
    });
  }

  return edges;
}

// Small yardage lines are lumpy (a big chance of zero, then one catch or run of
// almost any length), so a smooth model can't shift them: moving a 4.5–14.5
// yard line by one yard overshot the real books by 5–8 pts in the 2026-09-24
// accuracy test (Brooks, J. Smith, Love, Penix, Zaccheaus, Moore), versus
// ~1–3 pts on lines of 35+. Below this, only a sharp book at the exact line
// counts.
const YARDAGE_MARKETS = new Set([
  'player_rush_yds',
  'player_reception_yds',
  'player_pass_yds',
  'Rushing Yards',
  'Receiving Yards',
  'Passing Yards',
]);
const SMALL_YARDAGE_LINE = 15;

function consensusOver(sharp: SharpQuote[], line: number, market?: string): number | null {
  let num = 0;
  let den = 0;
  const exactOnly = market != null && YARDAGE_MARKETS.has(market) && line < SMALL_YARDAGE_LINE;
  for (const q of sharp) {
    if (exactOnly && q.line !== line) continue;
    if (Math.abs(q.line - line) / Math.max(q.line, 0.5) > MAX_ESTIMATED_GAP) continue;
    const w = SHARP_BOOKS[q.book] * (q.line === line ? 1 : 0.6); // exact quotes count more
    num += w * shiftOverProb(q.overProb, q.line, line, market);
    den += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * Probability the pick wins, given it doesn't push. Half-point lines can't
 * push. On a whole-number line (PrizePicks posts some) landing exactly on it
 * voids the pick, so it's neither a win nor a loss: over = P(X ≥ L+1),
 * under = P(X ≤ L−1), and we condition on no push.
 */
export function sideWinProb(sharp: SharpQuote[], line: number, side: PropSide, market?: string): number | null {
  if (!Number.isInteger(line)) {
    const pOver = consensusOver(sharp, line, market);
    return pOver == null ? null : side === 'over' ? pOver : 1 - pOver;
  }
  const over = consensusOver(sharp, line + 0.5, market);
  const overOrPush = consensusOver(sharp, line - 0.5, market);
  if (over == null || overOrPush == null) return null;
  const under = 1 - overOrPush;
  const decided = over + under;
  if (decided <= 0) return null;
  return (side === 'over' ? over : under) / decided;
}

function breakevenFor(book: string, price: number | null): { be: number; basis: 'entry' | 'price' } | null {
  const flat = PLATFORMS[book]?.breakeven;
  if (flat != null && (price == null || (price >= FLAT_PRICE_MIN && price <= FLAT_PRICE_MAX))) {
    return { be: flat, basis: 'entry' };
  }
  if (price == null) return null;
  return { be: americanToProb(price), basis: 'price' };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

async function fetchEdges(apiKey: string): Promise<PropEdgesResult> {
  const now = new Date();
  const maxEvents = Math.max(1, Number(process.env.PROPS_MAX_EVENTS) || 8);
  const books = [...Object.keys(SHARP_BOOKS), ...targetBooks()];

  const { data: sports } = await axios.get<Array<{ key: string; active: boolean }>>(`${ODDS_API}/sports`, {
    params: { apiKey },
    timeout: 10000,
  });
  const active = sports.filter((s) => s.active && SPORT_MARKETS[s.key]).map((s) => s.key);

  // Today's events per in-season sport (free endpoint), soonest first, capped for credits.
  const events: OddsEvent[] = [];
  for (const sportKey of active) {
    try {
      const { data } = await axios.get<OddsEvent[]>(`${ODDS_API}/sports/${sportKey}/events`, {
        params: { apiKey },
        timeout: 10000,
      });
      events.push(...data.filter((e) => isOnTodaysSlate(e.commence_time, now) && new Date(e.commence_time) > now));
    } catch {
      // sport unavailable; skip
    }
  }
  events.sort((a, b) => a.commence_time.localeCompare(b.commence_time));

  const edges: PropEdge[] = [];
  const platformsSeen = new Set<string>();
  const sharpSeen = new Set<string>();
  let quotaErrors = 0;

  for (const ev of events.slice(0, maxEvents)) {
    const cfg = SPORT_MARKETS[ev.sport_key];
    let data: OddsEvent;
    try {
      ({ data } = await axios.get<OddsEvent>(`${ODDS_API}/sports/${ev.sport_key}/events/${ev.id}/odds`, {
        params: {
          apiKey,
          bookmakers: books.join(','),
          markets: [...cfg.markets, ...GAME_MARKETS].join(','),
          oddsFormat: 'american',
        },
        timeout: 15000,
      }));
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 401 || status === 429) quotaErrors++;
      continue;
    }

    for (const gl of collectGameLines(data, cfg.label)) {
      platformsSeen.add(gl.platform);
      sharpSeen.add('pinnacle'); // fairHomeWinProb/fairTotalOverProb only fire with sharp-book coverage
      edges.push(gl);
    }

    const gameLabel = `${ev.away_team} @ ${ev.home_team}`;
    for (const prop of collectQuotes(data, cfg.markets).values()) {
      if (prop.sharp.length === 0) continue;
      prop.sharp.forEach((q) => sharpSeen.add(q.book));

      for (const t of prop.targets) {
        platformsSeen.add(PLATFORMS[t.book].name);
        const p = sideWinProb(prop.sharp, t.line, t.side, prop.market);
        const be = breakevenFor(t.book, t.price);
        if (p == null || !be) continue;

        const edge = (p - be.be) * 100;
        if (edge < MIN_EDGE) continue;

        edges.push({
          id: `${ev.id}-${prop.market}-${prop.player}-${t.side}-${t.line}-${t.book}`.replace(/[^a-zA-Z0-9.-]/g, ''),
          sport: cfg.label,
          event: gameLabel,
          startTime: ev.commence_time,
          player: prop.player,
          market: marketLabel(prop.market),
          side: t.side,
          line: t.line,
          platform: PLATFORMS[t.book].name,
          price: be.basis === 'price' ? t.price : null,
          winProb: round1(p * 100),
          fairOdds: probToAmerican(p),
          breakeven: round1(be.be * 100),
          breakevenBasis: be.basis,
          edge: round1(edge),
          lineMatch: prop.sharp.some((q) => q.line === t.line) ? 'exact' : 'estimated',
          sharpLines: prop.sharp.map((q) => ({ ...q, overProb: round1(q.overProb * 100) })),
        });
      }
    }
  }

  if (edges.length === 0 && quotaErrors > 0) throw new OddsQuotaError();

  edges.sort((a, b) => b.edge - a.edge);

  return {
    generatedAt: now.toISOString(),
    source: edges.length > 0 ? 'live' : 'empty',
    message:
      edges.length > 0
        ? undefined
        : events.length === 0
          ? 'No games left on today’s slate.'
          : 'No pick’em lines currently beat the sharp market.',
    platformsSeen: [...platformsSeen].sort(),
    sharpBooksSeen: [...sharpSeen].sort(),
    edges: edges.slice(0, MAX_EDGES),
    breakevens: Object.fromEntries(
      targetBooks().map((k) => [PLATFORMS[k].name, PLATFORMS[k].breakeven == null ? null : PLATFORMS[k].breakeven! * 100]),
    ),
  };
}

class OddsQuotaError extends Error {
  constructor() {
    super('Odds API rejected prop requests (out of credits or invalid key)');
  }
}

// ---------------------------------------------------------------------------
// Pinnacle fallback (public guest feed, no key, no credits)
// ---------------------------------------------------------------------------

const PINNACLE_API = 'https://guest.api.arcadia.pinnacle.com/0.1';

/** Pinnacle sport id → leagues we surface (label shown in the UI). */
const PINNACLE_SPORTS: Record<number, Record<string, string>> = {
  3: { MLB: 'MLB' },
  4: { NBA: 'NBA', WNBA: 'WNBA' },
  15: { NFL: 'NFL', NCAA: 'NCAAF' },
  19: { NHL: 'NHL' },
};

// Pick'em apps don't post these as standard two-way picks (0.5 HR / anytime
// TD unders only exist as discounted entries), so they'd show fake edges.
const PINNACLE_SKIP_UNITS = new Set(['Home Runs', 'Touchdowns']);

// A side priced past ~-235 is almost never a standard pick'em pick; apps move
// the line or discount it. Listing it would overstate the edge.
const MAX_SHARP_ONLY_PROB = 0.7;

// Per-sport cap so one deep slate (MLB total bases) can't crowd out the rest.
const MAX_SHARP_ONLY_PER_SPORT = 50;

type PinnacleMatchup = {
  id: number;
  type: string;
  startTime: string;
  units?: string;
  league?: { name?: string };
  special?: { category?: string; description?: string };
  participants?: Array<{ id: number; name: string; alignment?: string }>;
  parent?: { participants?: Array<{ name: string; alignment?: string }> };
};

type PinnacleMarket = {
  matchupId: number;
  type: string;
  period: number;
  prices: Array<{ participantId: number; price: number; points?: number }>;
};

/**
 * The guest feed occasionally 401s a request that succeeds on retry; back off
 * briefly. (Only public query params: e.g. primaryOnly on /matchups needs an
 * auth token, so it must not be sent there.)
 */
async function pinnacleGet<T>(path: string, params: Record<string, boolean>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await axios.get<T>(`${PINNACLE_API}${path}`, { params, timeout: 15000 });
      return data;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const retryable = status === 401 || status === 429 || (status != null && status >= 500);
      if (!retryable || attempt >= 2) throw error;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

function bestPickemBreakeven(): { name: string; be: number } {
  let best = { name: 'Pick’em', be: 1 };
  for (const k of targetBooks()) {
    const be = PLATFORMS[k].breakeven;
    if (be != null && be < best.be) best = { name: PLATFORMS[k].name, be };
  }
  return best;
}

/** One player-prop total, as Pinnacle currently prices it. Shared by the edge
 *  scanner and the stale-line watcher so both read the exact same feed the
 *  exact same way — a divergent second copy is how the "two Max Muncys"
 *  mixup happened in an earlier one-off script. */
export type PinnaclePlayerProp = {
  id: string; // stable per player+market+event; safe to use as a snapshot key
  sport: string; // league label, e.g. "MLB"
  event: string; // "Away @ Home", or '' when the feed omits teams
  startTime: string;
  player: string;
  market: string; // "Total Bases", "Strikeouts", "Points", ...
  line: number;
  overPrice: number;
  underPrice: number;
  overProb: number; // devigged
};

/** Every upcoming player-prop total Pinnacle has posted, across sports. */
export async function fetchPinnaclePlayerProps(): Promise<PinnaclePlayerProp[]> {
  const now = new Date();
  const props: PinnaclePlayerProp[] = [];

  // Sequential per sport: bursts of parallel requests trip the feed's rate limit.
  for (const [sportId, leagues] of Object.entries(PINNACLE_SPORTS)) {
    let matchups: PinnacleMatchup[];
    let markets: PinnacleMarket[];
    try {
      matchups = await pinnacleGet<PinnacleMatchup[]>(`/sports/${sportId}/matchups`, { withSpecials: true });
      markets = await pinnacleGet<PinnacleMarket[]>(`/sports/${sportId}/markets/straight`, {
        primaryOnly: false,
        withSpecials: true,
      });
    } catch {
      continue; // feed unavailable for this sport
    }

    const totals = new Map<number, PinnacleMarket>();
    for (const m of markets) {
      if (m.type === 'total' && m.period === 0) totals.set(m.matchupId, m);
    }

    for (const s of matchups) {
      const league = leagues[s.league?.name ?? ''];
      if (!league || s.type !== 'special' || s.special?.category !== 'Player Props') continue;
      if (!isOnTodaysSlate(s.startTime, now) || new Date(s.startTime) <= now) continue;
      if (PINNACLE_SKIP_UNITS.has(s.units ?? '')) continue;

      // "Tarik Skubal Total Strikeouts" / "Tommy White Total Bases"
      const match = /^(.+?) Total (.+)$/.exec(s.special.description ?? '');
      const market = totals.get(s.id);
      if (!match || !market) continue;

      const names = new Map((s.participants ?? []).map((p) => [p.id, p.name]));
      const over = market.prices.find((p) => names.get(p.participantId) === 'Over');
      const under = market.prices.find((p) => names.get(p.participantId) === 'Under');
      if (!over || !under || over.points == null) continue;

      // "Max Muncy (Dodgers)" -> "Max Muncy" — Pinnacle disambiguates same-name
      // players this way; the apps list them under the plain name.
      const player = match[1].replace(/\s*\([^)]*\)$/, '');
      const marketName = match[2] === 'Bases' ? 'Total Bases' : match[2];
      const teams = s.parent?.participants ?? [];
      const away = teams.find((t) => t.alignment === 'away')?.name;
      const home = teams.find((t) => t.alignment === 'home')?.name;

      props.push({
        id: `pin-${s.id}`,
        sport: league,
        event: away && home ? `${away} @ ${home}` : '', // some feeds omit teams
        startTime: s.startTime,
        player,
        market: marketName,
        line: over.points,
        overPrice: over.price,
        underPrice: under.price,
        overProb: devigOver(americanToProb(over.price), americanToProb(under.price)),
      });
    }
  }
  return props;
}

// ---------------------------------------------------------------------------
// Pinnacle thresholds: free, no app lines needed.
//
// The apps set their line near the sharp median (every MLB total-bases prop
// PrizePicks/Underdog carried on 2026-09-22/24 was 48–54% at Pinnacle), so a
// lopsided Pinnacle price at Pinnacle's own line is usually NOT what the app
// offers — that's why sharp-only "65% Under 1.5" picks failed verification.
// What Pinnacle alone CAN answer: at what app line does each side become +EV?
// We shift Pinnacle's fair probability along the stat's distribution (the same
// Poisson/normal model used for estimated lines) and report the cutoffs, so
// the bettor just compares one number in the app.
// ---------------------------------------------------------------------------

export type PinnacleThreshold = {
  id: string;
  sport: string;
  event: string;
  startTime: string;
  player: string;
  market: string;
  pinnacleLine: number;
  overProbAtPinnacle: number; // %
  /** Over is +EV (≥ target) at any app line at or below this; null = never within range. */
  overIfAtMost: number | null;
  /** Under is +EV at any app line at or above this; null = never within range. */
  underIfAtLeast: number | null;
  targetPct: number; // win % required: best pick'em breakeven + MIN_EDGE + Pinnacle-only noise margin
};

// Beyond ~25% from Pinnacle's line the distribution shift is a guess, and the
// apps essentially never post that far off the market anyway.
const THRESHOLD_MAX_GAP = 0.25;

// Sharp books routinely disagree with each other by 1–3 units on these lines,
// each pricing its own line near 50%. Shifting Pinnacle's price to another
// book's line missed that book's actual price by 3.0 pts on average (48 NFL
// comparisons, 2026-09-24). A Pinnacle-only call has to clear that noise on
// top of the normal edge bar, or it's flagging ordinary disagreement.
const PINNACLE_ONLY_MARGIN = 0.03;

function thresholdsFor(prop: PinnaclePlayerProp, target: number) {
  if (YARDAGE_MARKETS.has(prop.market) && prop.line < SMALL_YARDAGE_LINE) {
    // Too lumpy to shift (see consensusOver): only Pinnacle's own line is trustworthy.
    return {
      overIfAtMost: prop.overProb >= target ? prop.line : null,
      underIfAtLeast: 1 - prop.overProb >= target ? prop.line : null,
    };
  }
  const span = Math.max(prop.line * THRESHOLD_MAX_GAP, 1);
  const lo = Math.max(0.5, prop.line - span);
  const hi = prop.line + span;
  let overIfAtMost: number | null = null;
  let underIfAtLeast: number | null = null;
  // x.5 lines only (step 1 from a .5 start): whole-number app lines can push.
  for (let x = Math.floor(lo) + 0.5; x <= hi; x += 1) {
    const pOver = shiftOverProb(prop.overProb, prop.line, x, prop.market);
    if (pOver >= target) overIfAtMost = x; // grid ascends, so keep the highest qualifying line
    if (underIfAtLeast == null && 1 - pOver >= target) underIfAtLeast = x; // first (lowest) qualifying line
  }
  return { overIfAtMost, underIfAtLeast };
}

/** Every upcoming Pinnacle prop with its +EV app-line cutoffs. Free (Pinnacle only). */
export async function fetchPinnacleThresholds(): Promise<PinnacleThreshold[]> {
  const best = bestPickemBreakeven();
  const target = best.be + MIN_EDGE / 100 + PINNACLE_ONLY_MARGIN;
  const props = await fetchPinnaclePlayerProps();
  return props
    .filter((p) => p.event)
    .map((prop) => ({
      id: prop.id,
      sport: prop.sport,
      event: prop.event,
      startTime: prop.startTime,
      player: prop.player,
      market: prop.market,
      pinnacleLine: prop.line,
      overProbAtPinnacle: round1(prop.overProb * 100),
      ...thresholdsFor(prop, target),
      targetPct: round1(target * 100),
    }));
}

export async function fetchPinnacleEdges(): Promise<PropEdgesResult> {
  const now = new Date();
  const best = bestPickemBreakeven();
  const edges: PropEdge[] = [];
  const props = await fetchPinnaclePlayerProps();

  for (const prop of props) {
    for (const side of ['over', 'under'] as const) {
      const p = side === 'over' ? prop.overProb : 1 - prop.overProb;
      const edge = (p - best.be) * 100;
      if (edge < MIN_EDGE || p > MAX_SHARP_ONLY_PROB) continue;

      edges.push({
        id: `${prop.id}-${side}`,
        sport: prop.sport,
        event: prop.event,
        startTime: prop.startTime,
        player: prop.player,
        market: prop.market,
        side,
        line: prop.line,
        platform: best.name,
        price: null,
        winProb: round1(p * 100),
        fairOdds: probToAmerican(p),
        breakeven: round1(best.be * 100),
        breakevenBasis: 'entry',
        edge: round1(edge),
        lineMatch: 'unverified',
        sharpLines: [{ book: 'pinnacle', line: prop.line, overProb: round1(prop.overProb * 100) }],
      });
    }
  }

  edges.sort((a, b) => b.edge - a.edge);
  const perSport = new Map<string, number>();
  const capped = edges.filter((e) => {
    const n = (perSport.get(e.sport) ?? 0) + 1;
    perSport.set(e.sport, n);
    return n <= MAX_SHARP_ONLY_PER_SPORT;
  });

  return {
    generatedAt: now.toISOString(),
    source: capped.length > 0 ? 'sharp-only' : 'empty',
    message:
      capped.length > 0
        ? 'Pick’em lines unavailable — showing Pinnacle sharp prices. Confirm each line matches in your app.'
        : 'No sharp props on today’s slate yet.',
    platformsSeen: [],
    sharpBooksSeen: ['pinnacle'],
    edges: capped,
    breakevens: Object.fromEntries(
      targetBooks().map((k) => [PLATFORMS[k].name, PLATFORMS[k].breakeven == null ? null : PLATFORMS[k].breakeven! * 100]),
    ),
  };
}

// ---------------------------------------------------------------------------
// Persistence + public API
// ---------------------------------------------------------------------------

function supabaseOrNull() {
  try {
    return getSupabaseAdmin();
  } catch {
    return null;
  }
}

function scanKey(now: Date): string {
  const hours = Math.max(1, Number(process.env.PROPS_SCAN_HOURS) || 12);
  return `${boardDayKey(now)}-s${Math.floor(now.getUTCHours() / hours)}`;
}

function statusResult(source: PropEdgesResult['source'], message: string): PropEdgesResult {
  return {
    generatedAt: new Date().toISOString(),
    source,
    message,
    platformsSeen: [],
    sharpBooksSeen: [],
    edges: [],
    breakevens: {},
  };
}

/** Drop plays whose games have started; keeps a cached scan honest between runs. */
function sanitize(result: PropEdgesResult, now = new Date()): PropEdgesResult {
  const edges = filterLegsForToday(result.edges, now).filter((e) => new Date(e.startTime) > now);
  return { ...result, edges };
}

async function storeResult(key: string, result: PropEdgesResult): Promise<void> {
  const db = supabaseOrNull();
  if (!db) return;
  await db
    .from('prop_edge_scans')
    .upsert({ scan_key: key, generated_at: result.generatedAt, payload: result })
    .then(undefined, () => undefined); // persistence is best-effort
}

/**
 * Cron entry point. Odds API scan (pick'em vs sharp) once per PROPS_SCAN_HOURS
 * window when enabled; otherwise — or if it's out of credits — a free Pinnacle
 * sharp-only scan on every run.
 */
export async function generatePropEdges(): Promise<PropEdgesResult> {
  const now = new Date();
  const apiKey = process.env.ODDS_API_KEY;

  if (scanEnabled() && apiKey) {
    const key = scanKey(now);
    const db = supabaseOrNull();
    if (db) {
      const { data } = await db.from('prop_edge_scans').select('payload').eq('scan_key', key).maybeSingle();
      if (data?.payload) return sanitize(data.payload as PropEdgesResult, now);
    }
    try {
      const result = await fetchEdges(apiKey);
      await storeResult(key, result);
      return result;
    } catch {
      // out of credits / API down → Pinnacle fallback below
    }
  }

  const fallback = await fetchPinnacleEdges();
  // Hourly key: refreshes every cron run without colliding with Odds API windows.
  await storeResult(`${now.toISOString().slice(0, 13)}-pin`, fallback);
  return fallback;
}

/** Read path for /api/props — never spends Odds API credits. */
export async function getPropEdges(): Promise<PropEdgesResult> {
  const db = supabaseOrNull();
  // No database (local dev): read Pinnacle live; it's free and the route is CDN-cached.
  if (!db) return fetchPinnacleEdges().catch(() => statusResult('empty', 'Prop scan unavailable right now.'));
  try {
    const { data } = await db
      .from('prop_edge_scans')
      .select('payload')
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.payload) return statusResult('empty', 'First prop scan runs on the next refresh.');
    return sanitize(data.payload as PropEdgesResult);
  } catch {
    return statusResult('empty', 'Prop scan unavailable right now.');
  }
}
