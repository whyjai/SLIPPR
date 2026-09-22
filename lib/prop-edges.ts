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
  lineMatch: 'exact' | 'estimated';
  sharpLines: Array<{ book: string; line: number; overProb: number }>;
};

export type PropEdgesResult = {
  generatedAt: string;
  source: 'live' | 'disabled' | 'unconfigured' | 'empty';
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

const MIN_EDGE = 1; // points; below this isn't worth listing
const MAX_EDGES = 150;
const MAX_ESTIMATED_GAP = 0.2; // skip line mismatches >20% — model gets unreliable

function scanEnabled(): boolean {
  return /^(on|1|true|yes)$/i.test(process.env.PROP_SCAN ?? '');
}

function targetBooks(): string[] {
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

/** Estimate P(over targetLine) from fair P(over sharpLine). */
function shiftOverProb(pOver: number, sharpLine: number, targetLine: number): number {
  if (sharpLine === targetLine) return pOver;
  if (sharpLine < 12) {
    // Low counting stats (Ks, receptions, SOG, 3s) → Poisson
    const lam = fitPoisson(sharpLine, pOver);
    return 1 - poissonCdf(Math.floor(targetLine), lam);
  }
  // Yardage / points → normal, sd scales with the line
  const sd = Math.max(0.3 * sharpLine, 3);
  const median = sharpLine + sd * normPpf(1 - pOver);
  return 1 - normCdf((targetLine - median) / sd);
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

function consensusOver(sharp: SharpQuote[], line: number): number | null {
  let num = 0;
  let den = 0;
  for (const q of sharp) {
    if (Math.abs(q.line - line) / Math.max(q.line, 0.5) > MAX_ESTIMATED_GAP) continue;
    const w = SHARP_BOOKS[q.book] * (q.line === line ? 1 : 0.6); // exact quotes count more
    num += w * shiftOverProb(q.overProb, q.line, line);
    den += w;
  }
  return den > 0 ? num / den : null;
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

  for (const ev of events.slice(0, maxEvents)) {
    const cfg = SPORT_MARKETS[ev.sport_key];
    let data: OddsEvent;
    try {
      ({ data } = await axios.get<OddsEvent>(`${ODDS_API}/sports/${ev.sport_key}/events/${ev.id}/odds`, {
        params: { apiKey, bookmakers: books.join(','), markets: cfg.markets.join(','), oddsFormat: 'american' },
        timeout: 15000,
      }));
    } catch {
      continue;
    }

    const gameLabel = `${ev.away_team} @ ${ev.home_team}`;
    for (const prop of collectQuotes(data, cfg.markets).values()) {
      if (prop.sharp.length === 0) continue;
      prop.sharp.forEach((q) => sharpSeen.add(q.book));

      for (const t of prop.targets) {
        platformsSeen.add(PLATFORMS[t.book].name);
        const pOver = consensusOver(prop.sharp, t.line);
        const be = breakevenFor(t.book, t.price);
        if (pOver == null || !be) continue;

        const p = t.side === 'over' ? pOver : 1 - pOver;
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

/** Cron entry point: scans once per PROPS_SCAN_HOURS window and persists. */
export async function generatePropEdges(): Promise<PropEdgesResult> {
  if (!scanEnabled()) return statusResult('disabled', 'Set PROP_SCAN=on to enable prop scanning.');
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return statusResult('unconfigured', 'ODDS_API_KEY is not configured.');

  const now = new Date();
  const key = scanKey(now);
  const db = supabaseOrNull();

  if (db) {
    const { data } = await db.from('prop_edge_scans').select('payload').eq('scan_key', key).maybeSingle();
    if (data?.payload) return sanitize(data.payload as PropEdgesResult, now);
  }

  const result = await fetchEdges(apiKey);
  if (db) {
    await db
      .from('prop_edge_scans')
      .upsert({ scan_key: key, generated_at: result.generatedAt, payload: result })
      .then(undefined, () => undefined); // persistence is best-effort
  }
  return result;
}

/** Read path for /api/props — never spends API credits. */
export async function getPropEdges(): Promise<PropEdgesResult> {
  if (!scanEnabled()) return statusResult('disabled', 'Prop scanning is not enabled yet.');
  const db = supabaseOrNull();
  if (!db) return statusResult('unconfigured', 'Database is not configured.');
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
