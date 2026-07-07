import axios from 'axios';
import { getSupabaseAdmin } from './supabase-admin';
import { runCouncil, passesCouncil, type CouncilCandidate, type CouncilSeat } from './council';
import {
  runScout,
  enrichLegsWithScout,
  type ScoutMeta,
  type ScoutResult,
} from './scout';
import {
  assessLegRisk,
  capacityAdvisory,
  COMPLIANCE_DISCLAIMER,
  councilSessionMeta,
  partitionLegsForPublication,
  type FadeAlert,
} from './leg-compliance';

export type MarketType = 'moneyline' | 'spread' | 'total' | 'player_prop';

export type Sport =
  | 'MLB'
  | 'WNBA'
  | 'Soccer'
  | 'Tennis'
  | 'MMA'
  | 'NBA'
  | 'NFL'
  | 'NHL';

export type LegGradeLetter = 'A+' | 'A' | 'B+' | 'B' | 'C';

export type BoardLeg = {
  id: string;
  sport: Sport;
  market: MarketType;
  event: string;
  pick: string;
  book: string;
  americanOdds: number;
  impliedProb: number; // best available price, as %
  fairProb: number; // devigged consensus, as %
  edge: number; // fairProb - impliedProb, in points
  confidence: number; // council confidence 0-100
  agreement: number; // models in agreement
  grade: LegGradeLetter;
  reasoning: string;
  startTime: string;
};

export type { FadeAlert } from './leg-compliance';

export type CouncilMeta = {
  enabled: boolean;
  responded: number;
  seats: CouncilSeat[];
};

export type { ScoutMeta };

export type LegBoardResult = {
  generatedAt: string;
  source: 'live' | 'simulated' | 'pending';
  refreshWindow: string;
  /** Council session 1–8 for the UTC day (every 3h). */
  sessionIndex: number;
  sessionsPerDay: number;
  legs: BoardLeg[];
  /** Lines flagged as likely overpriced / poor plays — informational research only. */
  fadeAlerts: FadeAlert[];
  warnings: string[];
  capacityAdvisory: string;
  complianceDisclaimer: string;
  scout?: ScoutMeta;
  council: CouncilMeta;
};

const BOARD_SIZE = 50;
const COUNCIL_SIZE = 10;
const MIN_LIVE_LEGS = 3;

/** US Eastern calendar day — how bettors mean "today's slate". */
const BOARD_TZ = 'America/New_York';

/** Prefer in-season books; never lump NCAAF/CFL into NFL. */
const PREFERRED_SPORT_KEYS = [
  'baseball_mlb',
  'basketball_wnba',
  'basketball_nba',
  'icehockey_nhl',
  'americanfootball_nfl',
  'soccer_usa_mls',
  'soccer_epl',
  'soccer_uefa_champs_league',
  'tennis_atp',
  'tennis_wta',
  'mma_mixed_martial_arts',
];

function boardDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BOARD_TZ }).format(date);
}

/** Event tips today (ET) and hasn't been over for hours. */
export function isOnTodaysSlate(startTimeIso: string, now = new Date()): boolean {
  const start = new Date(startTimeIso);
  if (Number.isNaN(start.getTime())) return false;
  if (start.getTime() < now.getTime() - 6 * 3600_000) return false;
  return boardDayKey(start) === boardDayKey(now);
}

function filterLegsForToday(legs: BoardLeg[], now = new Date()): BoardLeg[] {
  return legs.filter((l) => isOnTodaysSlate(l.startTime, now));
}

function sanitizeBoardForToday(board: LegBoardResult, now = new Date()): LegBoardResult {
  const legs = filterLegsForToday(board.legs, now);
  if (legs.length === board.legs.length) return board;
  const dropped = board.legs.length - legs.length;
  return {
    ...board,
    legs,
    warnings: [
      `Excluded ${dropped} line(s) outside today's slate (US Eastern).`,
      ...board.warnings,
    ].slice(0, 8),
  };
}

// The Odds API free tier is 500 credits/month; a multi-sport scan costs ~6.
// Default cadence of 12h (2 scans/day) fits the free tier; set SCAN_HOURS=3
// on a paid key for a fresh scan on all 8 daily refresh windows.
const SCAN_HOURS = Math.max(1, Number(process.env.SCAN_HOURS) || 12);

// ---------------------------------------------------------------------------
// Odds math
// ---------------------------------------------------------------------------

export function americanToImplied(odds: number): number {
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

export function impliedToAmerican(p: number): number {
  const raw = p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p;
  return Math.round(raw / 5) * 5;
}

export function americanToDecimal(odds: number): number {
  return odds < 0 ? 1 + 100 / -odds : 1 + odds / 100;
}

/**
 * Expected value per 1 unit staked, given the devigged fair win probability and
 * the actual offered American odds. Positive = a +EV bet (the price pays more
 * than the true probability warrants). This is what a sharp bettor optimizes —
 * NOT raw win probability, which just surfaces no-payout favorites.
 */
export function evPerUnit(fairProbPct: number, americanOdds: number): number {
  const p = Math.min(1, Math.max(0, fairProbPct / 100));
  const dec = americanToDecimal(americanOdds);
  return p * (dec - 1) - (1 - p);
}

/** Reward the parlay sweet spot (~ -200..+200); taper for shorter/longer prices. */
function oddsBandBonus(odds: number): number {
  if (odds >= -200 && odds <= 200) return 6;
  if (odds >= -300 && odds <= 300) return 3;
  return 0;
}

/**
 * The researcher's ranking function. Value-first: expected value is the spine,
 * reinforced by line-shopping edge, council endorsement, and a bias toward
 * parlayable prices. Win probability is deliberately NOT a primary term.
 */
function legScore(leg: BoardLeg): number {
  const evPct = evPerUnit(leg.fairProb, leg.americanOdds) * 100;
  return (
    evPct * 6 +
    Math.max(0, leg.edge) * 2 +
    (leg.agreement ?? 0) * 2 +
    oddsBandBonus(leg.americanOdds)
  );
}

/**
 * Grades a leg on VALUE relative to a fair price. A/A+ are reserved for legs
 * that genuinely BEAT the market (positive EV / line-shopping edge) — a pro
 * grinds out 1-3% ROI, so those are rare and elite. B/B+ are fairly-priced,
 * playable legs. C is reserved for legs priced clearly worse than fair.
 */
function gradeFor(fairProb: number, edge: number, americanOdds: number): LegGradeLetter {
  const evPct = evPerUnit(fairProb, americanOdds) * 100;
  const score = evPct + Math.max(0, edge) * 0.4;
  if (score >= 1.5) return 'A+'; // clearly beats the market
  if (score >= 0.3) return 'A'; //  genuine positive value
  if (score >= -0.8) return 'B+'; // essentially fair
  if (score >= -2.2) return 'B'; //  fairly priced, playable
  return 'C'; //                     priced worse than fair — avoid
}

function councilFields(fairProb: number, edge: number, rand: () => number) {
  const confidence = Math.round(
    Math.min(92, Math.max(50, fairProb * 0.9 + Math.max(0, edge) * 3 + (rand() - 0.5) * 3)),
  );
  const agreement = Math.round(
    Math.min(COUNCIL_SIZE, Math.max(6, 6 + (confidence - 55) / 9 + edge / 2)),
  );
  return { confidence, agreement };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Board composition: an expert bettor's board — the BEST VALUE legs, not the
// biggest favorites. Legs must clear a value bar and sit in a parlayable odds
// range; no single game can dominate; ranking is by expected value.
// ---------------------------------------------------------------------------

const MIN_ODDS = -300; // shorter than this = no payout; excluded unless nothing else
const MAX_ODDS = 320; // longer than this = lottery noise
const MIN_EV = -0.03; // allow near-neutral; the sort still floats +EV to the top

function isParlayable(l: BoardLeg): boolean {
  return (
    l.americanOdds >= MIN_ODDS &&
    l.americanOdds <= MAX_ODDS &&
    l.fairProb >= 35 &&
    l.fairProb <= 82 &&
    evPerUnit(l.fairProb, l.americanOdds) > MIN_EV
  );
}

function composeBoard(legs: BoardLeg[]): BoardLeg[] {
  const deduped = [...new Map(legs.map((l) => [l.id, l])).values()];

  // Prefer genuinely parlayable value legs; fall back to the full pool only if
  // the slate is too thin to fill a board.
  const eligible = deduped.filter(isParlayable);
  const pool = eligible.length >= 20 ? eligible : deduped;
  const ranked = [...pool].sort((a, b) => legScore(b) - legScore(a));

  // Diversify: at most 2 legs per game, so one blowout can't flood the board and
  // slips built from it aren't secretly correlated.
  const perEvent = new Map<string, number>();
  const chosen: BoardLeg[] = [];
  for (const leg of ranked) {
    const n = perEvent.get(leg.event) ?? 0;
    if (n >= 2) continue;
    perEvent.set(leg.event, n + 1);
    chosen.push(leg);
    if (chosen.length >= BOARD_SIZE) break;
  }
  if (chosen.length < BOARD_SIZE) {
    const ids = new Set(chosen.map((l) => l.id));
    chosen.push(...ranked.filter((l) => !ids.has(l.id)).slice(0, BOARD_SIZE - chosen.length));
  }

  // Council-endorsed picks first (more approvals = higher), then value score.
  return chosen
    .sort((a, b) => (b.agreement ?? 0) - (a.agreement ?? 0) || legScore(b) - legScore(a))
    .slice(0, BOARD_SIZE);
}

// ---------------------------------------------------------------------------
// Predatory line detection on the scanned data
// ---------------------------------------------------------------------------

function detectPredatoryLines(legs: BoardLeg[]): string[] {
  const warnings: string[] = [];

  for (const leg of legs) {
    if (leg.americanOdds <= -150 && leg.edge <= -3) {
      warnings.push(
        `${leg.pick} at ${leg.book} (${leg.americanOdds}) is priced ${Math.abs(round1(leg.edge))} points above market consensus — classic favorite tax. Shop the line or skip.`,
      );
    }
  }

  const heavyFavorites = legs.filter((l) => l.impliedProb >= 80 && l.edge < 0);
  if (heavyFavorites.length >= 3) {
    warnings.push(
      `${heavyFavorites.length} heavy favorites on today's slate carry negative edge at every book — public-magnet lines that parlay apps push hardest. The board excludes them from top ranks.`,
    );
  }

  return warnings.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Live mode — The Odds API (the-odds-api.com).
// Devig method: strip each book's juice from two-way markets to a fair
// probability, take the consensus across books, then compare against the
// best available price. Positive edge = the best book lags consensus.
// ---------------------------------------------------------------------------

type OddsApiOutcome = { name: string; price: number; point?: number };
type OddsApiMarket = { key: string; outcomes: OddsApiOutcome[] };
type OddsApiBookmaker = { title: string; markets: OddsApiMarket[] };
type OddsApiEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
};

function mapSport(sportKey: string): Sport | null {
  if (sportKey.startsWith('baseball_mlb')) return 'MLB';
  if (sportKey.startsWith('basketball_wnba')) return 'WNBA';
  if (sportKey.startsWith('basketball_nba')) return 'NBA';
  if (sportKey.startsWith('americanfootball_nfl')) return 'NFL';
  if (sportKey.startsWith('icehockey_nhl')) return 'NHL';
  if (sportKey.startsWith('soccer')) return 'Soccer';
  if (sportKey.startsWith('tennis')) return 'Tennis';
  if (sportKey.startsWith('mma')) return 'MMA';
  return null;
}

function marketTypeFor(key: string): MarketType {
  if (key === 'spreads') return 'spread';
  if (key === 'totals') return 'total';
  return 'moneyline';
}

function pickLabel(market: string, outcome: OddsApiOutcome, event: OddsApiEvent): string {
  if (market === 'totals') return `${outcome.name} ${outcome.point}`;
  if (market === 'spreads') {
    const pt = outcome.point ?? 0;
    return `${outcome.name} ${pt > 0 ? '+' : ''}${pt}`;
  }
  if (outcome.name === 'Draw') return `Draw (${event.home_team} v ${event.away_team})`;
  return `${outcome.name} ML`;
}

async function fetchLiveLegs(apiKey: string, rand: () => number): Promise<BoardLeg[]> {
  // /v4/sports is a free call; use it to find in-season sports we support.
  const { data: sports } = await axios.get<Array<{ key: string; active: boolean }>>(
    'https://api.the-odds-api.com/v4/sports',
    { params: { apiKey }, timeout: 10000 },
  );

  const active = new Set(sports.filter((s) => s.active && mapSport(s.key)).map((s) => s.key));
  const sportKeys = [
    ...PREFERRED_SPORT_KEYS.filter((k) => active.has(k)),
    ...[...active].filter((k) => !PREFERRED_SPORT_KEYS.includes(k)),
  ].slice(0, 10);

  const eventLists = await Promise.all(
    sportKeys.map(async (key) => {
      try {
        const { data } = await axios.get<OddsApiEvent[]>(
          `https://api.the-odds-api.com/v4/sports/${key}/odds`,
          {
            params: {
              apiKey,
              regions: 'us',
              markets: 'h2h,spreads,totals',
              oddsFormat: 'american',
            },
            timeout: 12000,
          },
        );
        return data;
      } catch {
        return [];
      }
    }),
  );

  const legs: BoardLeg[] = [];

  const now = new Date();
  for (const event of eventLists.flat()) {
    const sport = mapSport(event.sport_key);
    if (!sport) continue;
    if (!isOnTodaysSlate(event.commence_time, now)) continue;

    const outcomes = new Map<
      string,
      { fairs: number[]; best: { implied: number; odds: number; book: string } }
    >();

    for (const book of event.bookmakers) {
      for (const market of book.markets) {
        const implieds = market.outcomes.map((o) => americanToImplied(o.price));
        const overround = implieds.reduce((a, b) => a + b, 0);
        if (overround <= 0) continue;

        market.outcomes.forEach((outcome, i) => {
          const key = `${market.key}|${pickLabel(market.key, outcome, event)}`;
          const fair = implieds[i] / overround;
          const implied = implieds[i];

          const entry = outcomes.get(key) ?? {
            fairs: [],
            best: { implied: 1, odds: outcome.price, book: book.title },
          };
          entry.fairs.push(fair);
          if (implied < entry.best.implied) {
            entry.best = { implied, odds: outcome.price, book: book.title };
          }
          outcomes.set(key, entry);
        });
      }
    }

    for (const [key, { fairs, best }] of outcomes) {
      if (fairs.length < 2) continue; // need multi-book consensus
      const [marketKey, pick] = key.split('|');
      const fairProb = (fairs.reduce((a, b) => a + b, 0) / fairs.length) * 100;
      const impliedProb = best.implied * 100;
      const edge = fairProb - impliedProb;
      const { confidence } = councilFields(fairProb, edge, rand);

      legs.push({
        id: `${event.id}-${key}`.replace(/[^a-zA-Z0-9|-]/g, ''),
        sport,
        market: marketTypeFor(marketKey),
        event: `${event.away_team} @ ${event.home_team}`,
        pick,
        book: best.book,
        americanOdds: best.odds,
        impliedProb: round1(impliedProb),
        fairProb: round1(fairProb),
        edge: round1(edge),
        confidence,
        agreement: 0, // set by the real council
        grade: gradeFor(fairProb, edge, best.odds),
        reasoning: `Devigged consensus across ${fairs.length} books prices this at ${round1(fairProb)}%; ${best.book} offers it at ${round1(impliedProb)}% implied (${edge >= 0 ? '+' : ''}${round1(edge)} pts vs market).`,
        startTime: event.commence_time,
      });
    }
  }

  return legs.filter((l) => l.fairProb >= 30);
}

// ---------------------------------------------------------------------------
// Simulated mode — realistic date-seeded slate, clearly labeled in the UI.
// Used only until ODDS_API_KEY is configured.
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const BOOKS = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'ESPN Bet', 'Fanatics'];

const SLATE: Record<string, { teams: string[]; props: Array<{ player: string; prop: string }> }> = {
  MLB: {
    teams: [
      'Yankees', 'Dodgers', 'Phillies', 'Braves', 'Astros', 'Orioles',
      'Mariners', 'Brewers', 'Guardians', 'Padres', 'Mets', 'Red Sox',
    ],
    props: [
      { player: 'Aaron Judge', prop: 'Over 1.5 Total Bases' },
      { player: 'Shohei Ohtani', prop: 'Over 0.5 Hits' },
      { player: 'Bryce Harper', prop: 'Over 1.5 Hits + Runs + RBIs' },
      { player: 'Juan Soto', prop: 'Over 0.5 Walks' },
      { player: 'Tarik Skubal', prop: 'Over 6.5 Strikeouts' },
      { player: 'Zack Wheeler', prop: 'Over 5.5 Strikeouts' },
      { player: 'Bobby Witt Jr.', prop: 'Over 1.5 Total Bases' },
      { player: 'Gunnar Henderson', prop: 'Over 0.5 Runs Scored' },
    ],
  },
  WNBA: {
    teams: ['Aces', 'Liberty', 'Lynx', 'Sun', 'Storm', 'Fever', 'Mercury', 'Sky'],
    props: [
      { player: "A'ja Wilson", prop: 'Over 21.5 Points' },
      { player: 'Caitlin Clark', prop: 'Over 7.5 Assists' },
      { player: 'Breanna Stewart', prop: 'Over 8.5 Rebounds' },
      { player: 'Napheesa Collier', prop: 'Over 19.5 Points' },
      { player: 'Angel Reese', prop: 'Over 11.5 Rebounds' },
    ],
  },
  Soccer: {
    teams: [
      'Inter Miami', 'LAFC', 'Columbus Crew', 'FC Cincinnati',
      'Real Madrid', 'Man City', 'PSG', 'Bayern Munich',
    ],
    props: [
      { player: 'Lionel Messi', prop: 'Over 1.5 Shots on Target' },
      { player: 'Erling Haaland', prop: 'Anytime Goalscorer' },
      { player: 'Kylian Mbappé', prop: 'Over 2.5 Shots' },
      { player: 'Denis Bouanga', prop: 'Anytime Goalscorer' },
    ],
  },
  Tennis: {
    teams: [
      'Alcaraz', 'Sinner', 'Djokovic', 'Zverev',
      'Swiatek', 'Sabalenka', 'Gauff', 'Rybakina',
    ],
    props: [
      { player: 'Carlos Alcaraz', prop: 'Over 11.5 Aces' },
      { player: 'Iga Swiatek', prop: 'To Win a Set 6-2 or Better' },
    ],
  },
  MMA: {
    teams: ['Makhachev', 'Topuria', 'Pereira', 'Jones', 'Adesanya', 'Volkanovski'],
    props: [
      { player: 'Islam Makhachev', prop: 'To Win by Submission' },
      { player: 'Alex Pereira', prop: 'Fight Under 2.5 Rounds' },
    ],
  },
};

const REASONING_POOLS: Record<MarketType, string[]> = {
  moneyline: [
    'Devigged consensus across 6 books prices this side {fair}%; best price implies just {implied}%. Line moved toward this side overnight.',
    'Council models converge on {fair}% true win probability — starting pitcher/lineup edge plus rest advantage. Market has not fully adjusted.',
    'Sharp handle concentrated on this side; consensus fair value {fair}% vs {implied}% implied at the best book.',
  ],
  spread: [
    'Key-number analysis favors this side of the spread; consensus prices cover probability at {fair}%.',
    'Power-rating gap exceeds the posted line by a full point. Council fair value {fair}% vs {implied}% implied.',
  ],
  total: [
    'Park factors, weather, and bullpen usage push the projected total off this line. Model consensus: {fair}% to cash.',
    'Pace and efficiency projections disagree with the market total; devigged consensus sits at {fair}%.',
  ],
  player_prop: [
    'Matchup-specific projection clears this line in {fair}% of simulations; the {implied}% implied price lags the projection.',
    'Usage trend over the last 10 games plus opponent positional weakness grades this {fair}% to hit.',
    'Prop line has not moved with the game total; council projects {fair}% hit rate vs {implied}% implied.',
  ],
};

function reasoningFor(market: MarketType, fair: number, implied: number, rand: () => number): string {
  const pool = REASONING_POOLS[market];
  const template = pool[Math.floor(rand() * pool.length)];
  return template
    .replace('{fair}', String(round1(fair)))
    .replace('{implied}', String(round1(implied)));
}

function simulatedLegs(seedKey: string): BoardLeg[] {
  const rand = mulberry32(hashString(seedKey));
  const legs: BoardLeg[] = [];
  let id = 0;

  const push = (
    sport: Sport,
    market: MarketType,
    event: string,
    pick: string,
    fairProbPct: number,
  ) => {
    const hasEdge = rand() < 0.4;
    const edge = hasEdge ? 0.5 + rand() * 3.5 : -(0.5 + rand() * 3.5);
    const impliedPct = Math.min(88, Math.max(25, fairProbPct - edge));
    const odds = impliedToAmerican(impliedPct / 100);
    const { confidence, agreement } = councilFields(fairProbPct, edge, rand);
    const startHour = 13 + Math.floor(rand() * 9);
    const start = new Date();
    start.setUTCHours(startHour + 4, [0, 5, 10, 35, 40][Math.floor(rand() * 5)], 0, 0);

    legs.push({
      id: `sim-${seedKey}-${id++}`,
      sport,
      market,
      event,
      pick,
      book: BOOKS[Math.floor(rand() * BOOKS.length)],
      americanOdds: odds,
      impliedProb: round1(impliedPct),
      fairProb: round1(fairProbPct),
      edge: round1(fairProbPct - impliedPct),
      confidence,
      agreement,
      grade: gradeFor(fairProbPct, fairProbPct - impliedPct, odds),
      reasoning: reasoningFor(market, fairProbPct, impliedPct, rand),
      startTime: start.toISOString(),
    });
  };

  for (const [sportName, slate] of Object.entries(SLATE)) {
    const sport = sportName as Sport;
    const teams = [...slate.teams].sort(() => rand() - 0.5);
    const gameCount = Math.floor(teams.length / 2);

    for (let g = 0; g < gameCount; g++) {
      const home = teams[g * 2];
      const away = teams[g * 2 + 1];
      const event =
        sport === 'Tennis' || sport === 'MMA'
          ? `${away} vs ${home}`
          : `${away} @ ${home}`;

      // Favorite + underdog moneylines: anchors AND multiplier candidates.
      const favProb = 55 + rand() * 24;
      const favIsHome = rand() < 0.55;
      const favTeam = favIsHome ? home : away;
      const dogTeam = favIsHome ? away : home;
      push(sport, 'moneyline', event, `${favTeam} ML`, favProb);
      if (favProb < 66 && rand() < 0.6) {
        push(sport, 'moneyline', event, `${dogTeam} ML`, 97 - favProb);
      }

      if (sport !== 'MMA') {
        const totalLine =
          sport === 'MLB'
            ? `${(7.5 + Math.floor(rand() * 4) * 0.5).toFixed(1)}`
            : sport === 'WNBA'
              ? `${(158.5 + Math.floor(rand() * 8)).toFixed(1)}`
              : sport === 'Soccer'
                ? '2.5'
                : `${(21.5 + Math.floor(rand() * 4)).toFixed(1)}`;
        const side = rand() < 0.5 ? 'Over' : 'Under';
        push(sport, 'total', event, `${side} ${totalLine}`, 48 + rand() * 15);
      }

      if (sport === 'MLB' || sport === 'WNBA') {
        const line = sport === 'MLB' ? '-1.5' : `-${(2.5 + Math.floor(rand() * 6)).toFixed(1)}`;
        push(sport, 'spread', event, `${favTeam} ${line}`, 42 + rand() * 20);
      }
    }

    for (const { player, prop } of slate.props) {
      push(sport, 'player_prop', `${player} — today's slate`, `${player} ${prop}`, 48 + rand() * 25);
    }
  }

  return legs;
}

// ---------------------------------------------------------------------------
// Supabase persistence: boards survive serverless cold starts, odds scans are
// reused across refresh windows (API quota), and the last live board is a
// fallback when a scan fails mid-month.
// ---------------------------------------------------------------------------

function supabaseOrNull() {
  try {
    return getSupabaseAdmin();
  } catch {
    return null;
  }
}

async function loadStoredBoard(windowKey: string): Promise<LegBoardResult | null> {
  const db = supabaseOrNull();
  if (!db) return null;
  try {
    const { data } = await db
      .from('leg_boards')
      .select('payload')
      .eq('window_key', windowKey)
      .maybeSingle();
    return (data?.payload as LegBoardResult) ?? null;
  } catch {
    return null;
  }
}

/** Most recently generated board, regardless of window (the read path). */
async function loadLatestBoard(): Promise<LegBoardResult | null> {
  const db = supabaseOrNull();
  if (!db) return null;
  try {
    const { data } = await db
      .from('leg_boards')
      .select('payload')
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.payload as LegBoardResult) ?? null;
  } catch {
    return null;
  }
}

async function storeBoard(windowKey: string, board: LegBoardResult): Promise<void> {
  const db = supabaseOrNull();
  if (!db) return;
  try {
    await db.from('leg_boards').upsert({
      window_key: windowKey,
      generated_at: board.generatedAt,
      source: board.source,
      payload: board,
    });
  } catch {
    // persistence is best-effort
  }
}

async function loadStoredScan(scanKey: string): Promise<BoardLeg[] | null> {
  const db = supabaseOrNull();
  if (!db) return null;
  try {
    const { data } = await db
      .from('odds_scans')
      .select('legs')
      .eq('scan_key', scanKey)
      .maybeSingle();
    return (data?.legs as BoardLeg[]) ?? null;
  } catch {
    return null;
  }
}

async function loadLatestScan(): Promise<BoardLeg[] | null> {
  const db = supabaseOrNull();
  if (!db) return null;
  try {
    const { data } = await db
      .from('odds_scans')
      .select('legs')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.legs as BoardLeg[]) ?? null;
  } catch {
    return null;
  }
}

async function storeScan(scanKey: string, legs: BoardLeg[]): Promise<void> {
  const db = supabaseOrNull();
  if (!db) return;
  try {
    await db.from('odds_scans').upsert({
      scan_key: scanKey,
      fetched_at: new Date().toISOString(),
      legs,
    });
  } catch {
    // persistence is best-effort
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

async function acquireLiveLegs(apiKey: string, scanKey: string, rand: () => number): Promise<BoardLeg[] | null> {
  const now = new Date();
  const stored = await loadStoredScan(scanKey);
  if (stored) {
    const today = filterLegsForToday(stored, now);
    if (today.length >= MIN_LIVE_LEGS) return today;
  }

  try {
    const fresh = await fetchLiveLegs(apiKey, rand);
    if (fresh.length >= MIN_LIVE_LEGS) {
      await storeScan(scanKey, fresh);
      return fresh;
    }
  } catch {
    // fall through to last known scan
  }

  const fallback = await loadLatestScan();
  if (!fallback) return null;
  const today = filterLegsForToday(fallback, now);
  return today.length >= MIN_LIVE_LEGS ? today : null;
}

async function applyCouncil(
  legs: BoardLeg[],
  scout: ScoutResult,
): Promise<{
  legs: BoardLeg[];
  fadeAlerts: FadeAlert[];
  council: CouncilMeta;
  warnings: string[];
  excludedAvoid: number;
}> {
  const debatePool: BoardLeg[] = scout.shortlistedIds
    .map((id) => legs.find((l) => l.id === id))
    .filter((l): l is BoardLeg => !!l);

  if (debatePool.length < MIN_LIVE_LEGS) {
    const assessments = new Map(
      debatePool.map((leg) => [
        leg.id,
        assessLegRisk(leg, { scoutBrief: scout.briefs[leg.id] }),
      ]),
    );
    const partitioned = partitionLegsForPublication(
      debatePool,
      assessments,
      (leg) => gradeFor(leg.fairProb, leg.edge, leg.americanOdds),
    );
    return {
      legs: partitioned.picks,
      fadeAlerts: partitioned.fadeAlerts,
      council: { enabled: false, responded: 0, seats: [] },
      warnings: ['Scout shortlist too thin for council review.'],
      excludedAvoid: partitioned.excludedAvoid,
    };
  }

  const candidates: CouncilCandidate[] = debatePool.map(
    ({ id, sport, market, event, pick, americanOdds, impliedProb, fairProb, edge }) => {
      const brief = scout.briefs[id];
      return {
        id,
        sport,
        market,
        event,
        pick,
        americanOdds,
        impliedProb,
        fairProb,
        edge,
        scoutNote: brief?.thesis,
        conviction: brief?.conviction,
        factors: brief?.factors,
        scoutQuality: brief?.qualityScore,
      };
    },
  );

  const result = await runCouncil(candidates);
  const council: CouncilMeta = {
    enabled: result.enabled,
    responded: result.responded,
    seats: result.seats,
  };
  const warnings: string[] = [];

  const applyVerdict = (leg: BoardLeg) => {
    const verdict = result.byLeg[leg.id];
    if (verdict && verdict.votes > 0) {
      leg.agreement = verdict.approvals;
      leg.confidence = Math.round((leg.confidence + verdict.avgConfidence) / 2);
    }
    leg.grade = gradeFor(leg.fairProb, leg.edge, leg.americanOdds);
  };

  if (result.responded === 0) {
    for (const leg of debatePool) applyVerdict(leg);
  } else {
    let surviving = debatePool.filter((leg) =>
      passesCouncil(result.byLeg[leg.id], result.responded),
    );

    if (surviving.length < MIN_LIVE_LEGS) {
      surviving = debatePool.slice(0, BOARD_SIZE);
      warnings.push(
        'Council did not reach 70% agreement; publishing Scout-ranked lines with market grades.',
      );
    }

    for (const leg of surviving) applyVerdict(leg);
    debatePool.length = 0;
    debatePool.push(...surviving);
  }

  const assessments = new Map(
    debatePool.map((leg) => [
      leg.id,
      assessLegRisk(leg, {
        scoutBrief: scout.briefs[leg.id],
        councilVerdict: result.byLeg[leg.id],
        councilResponded: result.responded,
      }),
    ]),
  );

  const rejectedByCouncil = legs.filter((leg) => {
    const v = result.byLeg[leg.id];
    return v && result.responded > 0 && v.votes > 0 && !passesCouncil(v, result.responded);
  });

  for (const leg of rejectedByCouncil) {
    if (!assessments.has(leg.id)) {
      assessments.set(
        leg.id,
        assessLegRisk(leg, {
          scoutBrief: scout.briefs[leg.id],
          councilVerdict: result.byLeg[leg.id],
          councilResponded: result.responded,
        }),
      );
    }
  }

  const partitionPool = [...debatePool, ...rejectedByCouncil.filter((l) => !debatePool.some((d) => d.id === l.id))];
  const partitioned = partitionLegsForPublication(
    partitionPool,
    assessments,
    (leg) => gradeFor(leg.fairProb, leg.edge, leg.americanOdds),
  );

  if (partitioned.excludedAvoid > 0) {
    warnings.push(
      `${partitioned.excludedAvoid} avoid-flagged leg(s) removed from the picks board (compliance filter).`,
    );
  }

  return {
    legs: partitioned.picks,
    fadeAlerts: partitioned.fadeAlerts,
    council,
    warnings,
    excludedAvoid: partitioned.excludedAvoid,
  };
}

function boardMeta(now: Date, pickCount: number, fadeCount: number) {
  const session = councilSessionMeta(now);
  return {
    sessionIndex: session.sessionIndex,
    sessionsPerDay: session.sessionsPerDay,
    refreshWindow: session.refreshWindow,
    capacityAdvisory: capacityAdvisory(pickCount, fadeCount),
    complianceDisclaimer: COMPLIANCE_DISCLAIMER,
  };
}

function emptyBoardShell(
  now: Date,
  partial: Omit<
    LegBoardResult,
    'fadeAlerts' | 'sessionIndex' | 'sessionsPerDay' | 'capacityAdvisory' | 'complianceDisclaimer'
  > & { fadeAlerts?: FadeAlert[] },
): LegBoardResult {
  const fadeAlerts = partial.fadeAlerts ?? [];
  const meta = boardMeta(now, partial.legs.length, fadeAlerts.length);
  return {
    ...partial,
    sessionIndex: meta.sessionIndex,
    sessionsPerDay: meta.sessionsPerDay,
    capacityAdvisory: meta.capacityAdvisory,
    complianceDisclaimer: meta.complianceDisclaimer,
    fadeAlerts,
  };
}

let memoryCache: { key: string; at: number; result: LegBoardResult } | null = null;
const MEMORY_TTL_MS = 15 * 60 * 1000;

/**
 * Reads the most recently published board. This is the ONLY path user requests
 * hit — it never scans odds or convenes the council. Generation is done solely
 * by the cron (8×/day at fixed times) so visitors can't trigger a refresh.
 */
function withRefreshedGrades(board: LegBoardResult): LegBoardResult {
  const legs = board.legs.map((leg) => ({
    ...leg,
    grade: gradeFor(leg.fairProb, leg.edge, leg.americanOdds),
  }));
  const fadeAlerts = board.fadeAlerts ?? [];
  return {
    ...board,
    legs,
    fadeAlerts,
    complianceDisclaimer: board.complianceDisclaimer ?? COMPLIANCE_DISCLAIMER,
    sessionIndex: board.sessionIndex ?? councilSessionMeta().sessionIndex,
    sessionsPerDay: board.sessionsPerDay ?? 8,
    capacityAdvisory:
      board.capacityAdvisory ?? capacityAdvisory(legs.length, fadeAlerts.length),
  };
}

export async function getPublishedBoard(): Promise<LegBoardResult> {
  const latest = await loadLatestBoard();
  if (latest) {
    const sanitized = sanitizeBoardForToday(latest);
    if (sanitized.legs.length > 0) return withRefreshedGrades(sanitized);
  }

  // No board has been generated yet (cron hasn't run since setup). Return a
  // labelled placeholder rather than generating on a user request.
  const now = new Date();
  return emptyBoardShell(now, {
    generatedAt: now.toISOString(),
    source: 'pending',
    refreshWindow: 'Board warming up — the council convenes shortly',
    legs: [],
    warnings: [],
    council: { enabled: false, responded: 0, seats: [] },
  });
}

/**
 * Generates a fresh board (odds scan → DFS → council) and persists it.
 * CRON-ONLY. Runs once per 3-hour window; the window key dedupes accidental
 * double-runs within a window.
 */
export async function generateLegBoard(): Promise<LegBoardResult> {
  const now = new Date();
  const window = Math.floor(now.getUTCHours() / 3);
  const windowKey = `${now.toISOString().slice(0, 10)}-w${window}`;
  const scanKey = `${now.toISOString().slice(0, 10)}-s${Math.floor(now.getUTCHours() / SCAN_HOURS)}`;

  if (memoryCache && memoryCache.key === windowKey && Date.now() - memoryCache.at < MEMORY_TTL_MS) {
    return memoryCache.result;
  }

  const stored = await loadStoredBoard(windowKey);
  if (stored) {
    const sanitized = sanitizeBoardForToday(stored, now);
    if (sanitized.source === 'live' && sanitized.legs.length >= MIN_LIVE_LEGS) {
      memoryCache = { key: windowKey, at: Date.now(), result: sanitized };
      return sanitized;
    }
  }

  const rand = mulberry32(hashString(windowKey));
  const apiKey = process.env.ODDS_API_KEY;

  let quantLegs: BoardLeg[] | null = null;
  let source: LegBoardResult['source'] = 'simulated';
  let warnings: string[] = [];

  if (apiKey) {
    quantLegs = await acquireLiveLegs(apiKey, scanKey, rand);
    if (quantLegs && quantLegs.length >= MIN_LIVE_LEGS) {
      source = 'live';
    } else {
      quantLegs = null;
    }
  }

  if (!quantLegs || quantLegs.length < MIN_LIVE_LEGS) {
    if (apiKey) {
      const pending = emptyBoardShell(now, {
        generatedAt: now.toISOString(),
        source: 'pending',
        refreshWindow: "Today's slate only — no live lines yet",
        legs: [],
        warnings: [
          'Only games tipping off today (US Eastern) are published.',
          'Check back closer to first pitch; futures and tomorrow\'s lines are excluded.',
        ],
        council: { enabled: false, responded: 0, seats: [] },
      });
      memoryCache = { key: windowKey, at: Date.now(), result: pending };
      await storeBoard(windowKey, pending);
      return pending;
    }
    quantLegs = simulatedLegs(windowKey);
    source = 'simulated';
    warnings = [];
  }

  warnings = [...detectPredatoryLines(quantLegs), ...warnings];

  // Real council only judges real data; demo mode keeps its labeled
  // synthetic agreement numbers.
  let council: CouncilMeta = {
    enabled: false,
    responded: 0,
    seats: [],
  };
  let legs = quantLegs;
  let fadeAlerts: FadeAlert[] = [];
  let scoutMeta: ScoutMeta | undefined;
  if (source === 'live') {
    const scout = await runScout(quantLegs);
    scoutMeta = scout.meta;
    quantLegs = enrichLegsWithScout(quantLegs, scout);
    const judged = await applyCouncil(quantLegs, scout);
    legs = judged.legs;
    fadeAlerts = judged.fadeAlerts;
    council = judged.council;
    warnings = [...judged.warnings, ...warnings];
    if (scout.meta.responded && scout.meta.slateSummary) {
      warnings = [`Scout: ${scout.meta.slateSummary}`, ...warnings];
    }
  } else {
    const assessments = new Map(
      quantLegs.map((leg) => [leg.id, assessLegRisk(leg)]),
    );
    const partitioned = partitionLegsForPublication(
      quantLegs,
      assessments,
      (leg) => gradeFor(leg.fairProb, leg.edge, leg.americanOdds),
    );
    legs = partitioned.picks;
    fadeAlerts = partitioned.fadeAlerts;
    if (partitioned.excludedAvoid > 0) {
      warnings.push(
        `${partitioned.excludedAvoid} avoid-flagged leg(s) removed from the picks board (compliance filter).`,
      );
    }
  }

  const composed = composeBoard(legs);
  const result = emptyBoardShell(now, {
    generatedAt: now.toISOString(),
    source,
    refreshWindow: councilSessionMeta(now).refreshWindow,
    legs: composed,
    fadeAlerts,
    warnings: warnings.slice(0, 8),
    scout: scoutMeta,
    council,
  });

  memoryCache = { key: windowKey, at: Date.now(), result };
  await storeBoard(windowKey, result);

  // Feed the verified track record with every published live leg (idempotent).
  if (source === 'live') {
    const { logPublishedLegs } = await import('./track-record');
    await logPublishedLegs(result);
  }

  return result;
}
