import axios from 'axios';
import { getSupabaseAdmin } from './supabase-admin';
import { americanToProb, fetchPinnaclePlayerProps, PLATFORMS, targetBooks, type PinnaclePlayerProp } from './prop-edges';
import { boardDayKey } from './slate';

/**
 * Stale Line Alerts: Pinnacle (free, ~5 min resolution) is the fastest-moving
 * book on player props. Pick'em apps and Fliff sometimes take longer to react
 * to a lineup change, a scratch, or a role shift. When a Pinnacle price moves
 * and an app hasn't caught up, that gap is the edge — independent of payout
 * multiplier, which is what the earlier "high confidence" asks kept running
 * into (a bigger multiplier and a safer pick are priced against each other;
 * a stale line is a rare case where the app is just wrong for a few minutes).
 *
 * Design, validated by hand over a full slate on 2026-09-22 (see session):
 *  - Snapshot Pinnacle's player props on every run (free).
 *  - Diff against the last stored snapshot; only props that moved trigger an
 *    Odds API call, batched one request per (event, market) — never per pick.
 *  - Compare the app's price at Pinnacle's OLD, unmoved line: if the app is
 *    still there and Pinnacle has since moved, that's the stale line.
 *  - A hard per-day Odds API budget (STALE_LINE_BUDGET) caps spend; once hit,
 *    Pinnacle snapshotting keeps running (free) but app checks stop.
 *  - Every fired alert is deduplicated by (prop, side, platform) so a line
 *    that stays stale across several runs alerts once, not every run.
 *
 * Cadence: this module does one pass per call — the caller decides frequency.
 * Pinnacle's guest feed rate-limits well under 1/minute, so realistically this
 * wants an external scheduler hitting /api/cron/stale-lines every few
 * minutes (Vercel Cron's minimum interval depends on the plan) rather than
 * Vercel's own once-per-day-on-Hobby cron.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Pinnacle league label -> The Odds API sport key (matches PINNACLE_SPORTS' values in prop-edges.ts). */
const ODDS_API_SPORT_KEY: Record<string, string> = {
  MLB: 'baseball_mlb',
  NBA: 'basketball_nba',
  WNBA: 'basketball_wnba',
  NFL: 'americanfootball_nfl',
  NCAAF: 'americanfootball_ncaaf',
  NHL: 'icehockey_nhl',
};

/** Pinnacle's market label -> The Odds API market key. Verified against live
 *  responses for MLB/WNBA/NFL (2026-09-22 and -24); NHL is a best guess since
 *  no NHL props were live to check — worst case those markets are just never
 *  checked (a market with no key mapping is skipped, not mis-checked). */
const ODDS_API_MARKET_KEY: Record<string, string> = {
  'Total Bases': 'batter_total_bases',
  Strikeouts: 'pitcher_strikeouts',
  'Hits Allowed': 'pitcher_hits_allowed',
  'Earned Runs': 'pitcher_earned_runs',
  Points: 'player_points',
  Rebounds: 'player_rebounds',
  Assists: 'player_assists',
  'Threes Made': 'player_threes',
  'Pts & Rebs & Asts': 'player_points_rebounds_assists',
  'Passing Yards': 'player_pass_yds',
  'Rushing Yards': 'player_rush_yds',
  'Receiving Yards': 'player_reception_yds',
  Receptions: 'player_receptions',
  'Touchdown Passes': 'player_pass_tds',
  'Shots on Goal': 'player_shots_on_goal',
  Saves: 'player_total_saves',
};

const MOVE_PROB_PTS = 0.035; // Pinnacle over-prob shift that counts as "moved"
const ALERT_EDGE_PTS = 0.03; // min edge (win prob − app breakeven) to alert
const ODDS_API = 'https://api.the-odds-api.com/v4';
const DEFAULT_BUDGET = 60;

function scanEnabled(): boolean {
  return /^(on|1|true|yes)$/i.test(process.env.STALE_LINE_SCAN ?? '');
}

function dailyBudget(): number {
  return Math.max(0, Number(process.env.STALE_LINE_BUDGET) || DEFAULT_BUDGET);
}

// ---------------------------------------------------------------------------
// Result / alert types
// ---------------------------------------------------------------------------

export type StaleLineAlert = {
  id: string; // dedup key: propId|side|platform
  propId: string;
  platform: string;
  player: string;
  market: string;
  side: 'Over' | 'Under';
  line: number;
  sport: string;
  event: string;
  startTime: string;
  price: number | null; // null on a flat-payout standard pick'em price
  sharpWinPct: number;
  breakevenPct: number;
  edgePct: number;
  createdAt: string;
};

export type StaleLineScanResult = {
  ranAt: string;
  scanned: boolean;
  reason?: string;
  propsTracked: number;
  moved: number;
  checked: number;
  newAlerts: StaleLineAlert[];
  budget: { used: number; max: number };
};

// ---------------------------------------------------------------------------
// Persistence (best-effort — falls back to a no-op if Supabase isn't configured)
// ---------------------------------------------------------------------------

function supabaseOrNull() {
  try {
    return getSupabaseAdmin();
  } catch {
    return null;
  }
}

type StoredSnapshot = { line: number; over_prob: number };

async function loadSnapshots(): Promise<Map<string, StoredSnapshot>> {
  const db = supabaseOrNull();
  if (!db) return new Map();
  const { data } = await db.from('stale_line_snapshots').select('prop_id, line, over_prob');
  return new Map((data ?? []).map((r) => [r.prop_id as string, { line: r.line as number, over_prob: r.over_prob as number }]));
}

async function saveSnapshots(props: PinnaclePlayerProp[]): Promise<void> {
  const db = supabaseOrNull();
  if (!db || props.length === 0) return;
  const rows = props.map((p) => ({
    prop_id: p.id,
    player: p.player,
    market: p.market,
    sport: p.sport,
    event: p.event,
    line: p.line,
    over_prob: p.overProb,
    start_time: p.startTime,
    updated_at: new Date().toISOString(),
  }));
  // Batches of 500: Supabase's upsert payload limit.
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .from('stale_line_snapshots')
      .upsert(rows.slice(i, i + 500), { onConflict: 'prop_id' })
      .then(undefined, () => undefined); // best-effort
  }
}

async function alreadyAlerted(ids: string[]): Promise<Set<string>> {
  const db = supabaseOrNull();
  if (!db || ids.length === 0) return new Set();
  const { data } = await db.from('stale_line_alerts').select('id').in('id', ids);
  return new Set((data ?? []).map((r) => r.id as string));
}

async function saveAlerts(alerts: StaleLineAlert[]): Promise<void> {
  const db = supabaseOrNull();
  if (!db || alerts.length === 0) return;
  await db
    .from('stale_line_alerts')
    .insert(
      alerts.map((a) => ({
        id: a.id,
        prop_id: a.propId,
        platform: a.platform,
        player: a.player,
        market: a.market,
        side: a.side,
        line: a.line,
        sport: a.sport,
        event: a.event,
        start_time: a.startTime,
        price: a.price,
        sharp_win_pct: a.sharpWinPct,
        breakeven_pct: a.breakevenPct,
        edge_pct: a.edgePct,
        created_at: a.createdAt,
      })),
    )
    .then(undefined, () => undefined); // best-effort
}

async function loadAndBumpBudget(spend: number): Promise<{ used: number; max: number }> {
  const max = dailyBudget();
  const db = supabaseOrNull();
  const day = boardDayKey(new Date());
  if (!db) return { used: 0, max }; // no persistence: can't track spend across runs, so never blocks
  const { data } = await db.from('stale_line_budget').select('requests_used').eq('day', day).maybeSingle();
  const used = (data?.requests_used as number | undefined) ?? 0;
  if (spend > 0) {
    await db
      .from('stale_line_budget')
      .upsert({ day, requests_used: used + spend })
      .then(undefined, () => undefined);
  }
  return { used: used + spend, max };
}

// ---------------------------------------------------------------------------
// Odds API — one request per (event, market) that moved
// ---------------------------------------------------------------------------

type OddsOutcome = { name: string; description?: string; price: number; point?: number };
type OddsEvent = { id: string; commence_time: string; home_team: string; away_team: string };

const eventCache = new Map<string, Promise<OddsEvent[]>>();

async function eventsFor(sportKey: string, apiKey: string): Promise<OddsEvent[]> {
  let p = eventCache.get(sportKey);
  if (!p) {
    p = axios.get<OddsEvent[]>(`${ODDS_API}/sports/${sportKey}/events`, { params: { apiKey }, timeout: 10000 }).then((r) => r.data);
    eventCache.set(sportKey, p);
  }
  return p;
}

async function checkGroup(
  apiKey: string,
  event: string,
  marketLabel: string,
  props: Array<{ prop: PinnaclePlayerProp; prior: StoredSnapshot }>,
): Promise<{ alerts: StaleLineAlert[]; spent: number }> {
  const marketKey = ODDS_API_MARKET_KEY[marketLabel];
  const sportKey = ODDS_API_SPORT_KEY[props[0].prop.sport];
  if (!marketKey || !sportKey) return { alerts: [], spent: 0 };

  let events: OddsEvent[];
  try {
    events = await eventsFor(sportKey, apiKey);
  } catch {
    return { alerts: [], spent: 0 };
  }
  // prop.event holds Pinnacle's full team names (fetchPinnaclePlayerProps doesn't
  // shorten them); The Odds API uses the same full names, so compare as-is.
  const match = events.find((e) => `${e.away_team} @ ${e.home_team}` === event);
  if (!match) return { alerts: [], spent: 0 };

  let data: { bookmakers?: Array<{ key: string; markets: Array<{ outcomes: OddsOutcome[] }> }> };
  try {
    const res = await axios.get(`${ODDS_API}/sports/${sportKey}/events/${match.id}/odds`, {
      params: { apiKey, bookmakers: targetBooks().join(','), markets: marketKey, oddsFormat: 'american' },
      timeout: 15000,
    });
    data = res.data;
  } catch {
    return { alerts: [], spent: 1 }; // still spent the request even on a non-2xx/network error
  }

  const alerts: StaleLineAlert[] = [];
  for (const { prop, prior } of props) {
    for (const bm of data.bookmakers ?? []) {
      const platform = PLATFORMS[bm.key];
      if (!platform) continue;
      for (const o of bm.markets[0]?.outcomes ?? []) {
        if (o.description !== prop.player || o.point !== prior.line) continue; // must be the OLD (stale) line
        const side = o.name as 'Over' | 'Under';
        // Win prob at the *new* Pinnacle price, since that's what's now true.
        const pAtOldLine = side === 'Over' ? prop.overProb : 1 - prop.overProb;
        const isFlat = platform.breakeven != null && o.price >= -140 && o.price <= 105;
        const be = isFlat ? platform.breakeven! : americanToProb(o.price);
        const edge = pAtOldLine - be;
        if (edge < ALERT_EDGE_PTS) continue;

        alerts.push({
          id: `${prop.id}|${side}|${bm.key}`,
          propId: prop.id,
          platform: platform.name,
          player: prop.player,
          market: prop.market,
          side,
          line: prior.line,
          sport: prop.sport,
          event: prop.event,
          startTime: prop.startTime,
          price: isFlat ? null : o.price,
          sharpWinPct: Math.round(pAtOldLine * 1000) / 10,
          breakevenPct: Math.round(be * 1000) / 10,
          edgePct: Math.round(edge * 1000) / 10,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
  return { alerts, spent: 1 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** One scan pass: snapshot Pinnacle, diff, check moved props against the
 *  apps within budget, persist, return what's new. Call this from a cron —
 *  more often finds more stale windows, but Pinnacle's guest feed throttles
 *  well under 1 request/minute. */
export async function scanStaleLines(): Promise<StaleLineScanResult> {
  const ranAt = new Date().toISOString();
  if (!scanEnabled()) {
    return { ranAt, scanned: false, reason: 'STALE_LINE_SCAN is not on', propsTracked: 0, moved: 0, checked: 0, newAlerts: [], budget: { used: 0, max: dailyBudget() } };
  }
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return { ranAt, scanned: false, reason: 'ODDS_API_KEY is not configured', propsTracked: 0, moved: 0, checked: 0, newAlerts: [], budget: { used: 0, max: dailyBudget() } };
  }

  const [props, prior] = await Promise.all([fetchPinnaclePlayerProps(), loadSnapshots()]);

  const moved = props
    .map((prop) => ({ prop, priorSnap: prior.get(prop.id) }))
    .filter(
      (r): r is { prop: PinnaclePlayerProp; priorSnap: StoredSnapshot } =>
        r.priorSnap != null && (r.priorSnap.line !== r.prop.line || Math.abs(r.priorSnap.over_prob - r.prop.overProb) >= MOVE_PROB_PTS),
    );

  const groups = new Map<string, Array<{ prop: PinnaclePlayerProp; prior: StoredSnapshot }>>();
  for (const { prop, priorSnap } of moved) {
    const key = `${prop.event}|${prop.market}`;
    groups.set(key, [...(groups.get(key) ?? []), { prop, prior: priorSnap }]);
  }

  const budgetSoFar = await loadAndBumpBudget(0);
  let spend = 0;
  let checked = 0;
  const collected: StaleLineAlert[] = [];

  for (const [key, rows] of groups) {
    if (rows[0].prop.event === '') continue; // can't resolve an Odds API event without team names
    if (budgetSoFar.used + spend >= budgetSoFar.max) break;
    const [event, market] = key.split('|');
    const { alerts, spent } = await checkGroup(apiKey, event, market, rows);
    spend += spent;
    checked++;
    collected.push(...alerts);
  }

  const seen = await alreadyAlerted(collected.map((a) => a.id));
  const newAlerts = collected.filter((a) => !seen.has(a.id));

  await Promise.all([saveSnapshots(props), saveAlerts(newAlerts), loadAndBumpBudget(spend)]);

  return {
    ranAt,
    scanned: true,
    propsTracked: props.length,
    moved: moved.length,
    checked,
    newAlerts,
    budget: { used: budgetSoFar.used + spend, max: budgetSoFar.max },
  };
}

/** Read path: recent alerts for the UI. Never touches the Odds API. */
export async function getRecentStaleAlerts(limit = 20): Promise<StaleLineAlert[]> {
  const db = supabaseOrNull();
  if (!db) return [];
  const { data } = await db
    .from('stale_line_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id,
    propId: r.prop_id,
    platform: r.platform,
    player: r.player,
    market: r.market,
    side: r.side,
    line: r.line,
    sport: r.sport,
    event: r.event,
    startTime: r.start_time,
    price: r.price,
    sharpWinPct: r.sharp_win_pct,
    breakevenPct: r.breakeven_pct,
    edgePct: r.edge_pct,
    createdAt: r.created_at,
  }));
}
