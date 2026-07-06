import { getSupabaseAdmin } from './supabase-admin';
import { americanToImplied, type BoardLeg, type LegBoardResult } from './leg-board';

/**
 * Verified track record engine.
 *
 * 1. logPublishedLegs — when a live board is generated, record each leg at its
 *    entry price (idempotent on leg id).
 * 2. captureClosingLines — near event start, record the market's closing price
 *    and compute CLV (how many points the entry beat the close).
 * 3. gradeSettledPicks — after an event, mark win/loss from final results.
 *
 * CLV > 0 across a sample is the honest, un-fakeable signal that the board is
 * genuinely beating the market — the differentiator competitors won't publish.
 */

type PickRow = {
  id: string;
  window_key: string;
  sport: string;
  market: string;
  event: string;
  pick: string;
  book: string | null;
  entry_odds: number;
  entry_implied: number;
  fair_prob: number;
  confidence: number;
  grade: string;
  closing_odds: number | null;
  closing_implied: number | null;
  clv: number | null;
  result: 'pending' | 'win' | 'loss' | 'push' | 'void';
  start_time: string | null;
  graded_at: string | null;
  created_at: string;
};

function adminOrNull() {
  try {
    return getSupabaseAdmin();
  } catch {
    return null;
  }
}

/** Persist every leg of a freshly generated LIVE board at its entry price. */
export async function logPublishedLegs(board: LegBoardResult): Promise<number> {
  if (board.source !== 'live') return 0; // never log simulated picks to the record
  const db = adminOrNull();
  if (!db) return 0;

  const rows = board.legs.map((leg: BoardLeg) => ({
    id: leg.id,
    window_key: board.refreshWindow,
    sport: leg.sport,
    market: leg.market,
    event: leg.event,
    pick: leg.pick,
    book: leg.book,
    entry_odds: leg.americanOdds,
    entry_implied: leg.impliedProb,
    fair_prob: leg.fairProb,
    confidence: leg.confidence,
    grade: leg.grade,
    start_time: leg.startTime,
  }));

  try {
    // ignoreDuplicates: a leg keeps its first (entry) price across refreshes.
    const { error } = await db
      .from('pick_results')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) return 0;
    return rows.length;
  } catch {
    return 0;
  }
}

/**
 * For picks whose event has started but have no closing line yet, record the
 * current best price as the close and compute CLV. `priceLookup` returns the
 * closing American odds for a pick id (wired to the odds provider's scores/
 * closing endpoint); when omitted or it returns null, the pick is skipped.
 */
export async function captureClosingLines(
  priceLookup: (pick: PickRow) => Promise<number | null>,
): Promise<number> {
  const db = adminOrNull();
  if (!db) return 0;

  const nowIso = new Date().toISOString();
  const { data } = await db
    .from('pick_results')
    .select('*')
    .is('closing_odds', null)
    .lte('start_time', nowIso)
    .limit(200);

  const picks = (data as PickRow[] | null) ?? [];
  let captured = 0;

  for (const pick of picks) {
    const closingOdds = await priceLookup(pick);
    if (closingOdds == null) continue;

    const closingImplied = Math.round(americanToImplied(closingOdds) * 1000) / 10;
    // CLV in points: entry implied is LOWER than close when we beat the market.
    const clv = Math.round((closingImplied - pick.entry_implied) * 10) / 10;

    try {
      await db
        .from('pick_results')
        .update({ closing_odds: closingOdds, closing_implied: closingImplied, clv })
        .eq('id', pick.id);
      captured += 1;
    } catch {
      // best-effort
    }
  }

  return captured;
}

/**
 * Grade pending picks whose events have finished. `resultLookup` returns
 * 'win' | 'loss' | 'push' | null (still pending) for a pick.
 */
export async function gradeSettledPicks(
  resultLookup: (pick: PickRow) => Promise<'win' | 'loss' | 'push' | null>,
): Promise<number> {
  const db = adminOrNull();
  if (!db) return 0;

  const cutoff = new Date(Date.now() - 3 * 3600_000).toISOString(); // started 3h+ ago
  const { data } = await db
    .from('pick_results')
    .select('*')
    .eq('result', 'pending')
    .lte('start_time', cutoff)
    .limit(200);

  const picks = (data as PickRow[] | null) ?? [];
  let graded = 0;

  for (const pick of picks) {
    const result = await resultLookup(pick);
    if (!result) continue;
    try {
      await db
        .from('pick_results')
        .update({ result, graded_at: new Date().toISOString() })
        .eq('id', pick.id);
      graded += 1;
    } catch {
      // best-effort
    }
  }

  return graded;
}

export type TrackRecordSummary = {
  totalGraded: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null; // %
  roiPer100: number | null; // flat $100/pick, in $
  avgClv: number | null; // points
  clvPositiveRate: number | null; // % of picks that beat the close
  pendingCount: number;
  byGrade: Array<{ grade: string; graded: number; winRate: number | null }>;
  recent: Array<{
    pick: string;
    sport: string;
    entryOdds: number;
    result: string;
    clv: number | null;
    createdAt: string;
  }>;
  updatedAt: string;
};

function profitUnits(odds: number): number {
  // Profit on a $100 stake if the pick wins.
  return odds > 0 ? odds : (100 / -odds) * 100;
}

/** Compute the public-facing aggregate summary. */
export async function getTrackRecord(): Promise<TrackRecordSummary | null> {
  const db = adminOrNull();
  if (!db) return null;

  const { data } = await db
    .from('pick_results')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(2000);

  const picks = (data as PickRow[] | null) ?? [];
  const graded = picks.filter((p) => p.result === 'win' || p.result === 'loss');
  const wins = graded.filter((p) => p.result === 'win');
  const losses = graded.filter((p) => p.result === 'loss');
  const pushes = picks.filter((p) => p.result === 'push').length;
  const withClv = picks.filter((p) => p.clv != null);

  const profit =
    wins.reduce((sum, p) => sum + profitUnits(p.entry_odds), 0) - losses.length * 100;

  const byGradeMap = new Map<string, { graded: number; wins: number }>();
  for (const p of graded) {
    const entry = byGradeMap.get(p.grade) ?? { graded: 0, wins: 0 };
    entry.graded += 1;
    if (p.result === 'win') entry.wins += 1;
    byGradeMap.set(p.grade, entry);
  }

  return {
    totalGraded: graded.length,
    wins: wins.length,
    losses: losses.length,
    pushes,
    winRate: graded.length ? Math.round((wins.length / graded.length) * 1000) / 10 : null,
    roiPer100: graded.length ? Math.round((profit / (graded.length * 100)) * 1000) / 10 : null,
    avgClv: withClv.length
      ? Math.round((withClv.reduce((s, p) => s + (p.clv ?? 0), 0) / withClv.length) * 100) / 100
      : null,
    clvPositiveRate: withClv.length
      ? Math.round((withClv.filter((p) => (p.clv ?? 0) > 0).length / withClv.length) * 1000) / 10
      : null,
    pendingCount: picks.filter((p) => p.result === 'pending').length,
    byGrade: ['A+', 'A', 'B+', 'B', 'C']
      .map((grade) => {
        const e = byGradeMap.get(grade);
        return {
          grade,
          graded: e?.graded ?? 0,
          winRate: e && e.graded ? Math.round((e.wins / e.graded) * 1000) / 10 : null,
        };
      })
      .filter((g) => g.graded > 0),
    recent: picks.slice(0, 25).map((p) => ({
      pick: p.pick,
      sport: p.sport,
      entryOdds: p.entry_odds,
      result: p.result,
      clv: p.clv,
      createdAt: p.created_at,
    })),
    updatedAt: new Date().toISOString(),
  };
}
