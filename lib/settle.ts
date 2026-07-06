import axios from 'axios';
import { getSupabaseAdmin } from './supabase-admin';
import { captureClosingLines, gradeSettledPicks } from './track-record';

/**
 * Wires the track-record engine to real data sources:
 *
 * - Closing lines come from the most recent stored odds scan (the price nearest
 *   event start ≈ the close), so CLV is computed with zero extra API cost.
 * - Results grade from The Odds API /scores endpoint. Moneyline markets grade
 *   cleanly from the winner; spreads/totals/props are left pending until a
 *   richer settlement source is wired (they don't grade reliably from a final
 *   score line alone).
 */

type PickRow = {
  id: string;
  sport: string;
  market: string;
  event: string;
  pick: string;
  entry_odds: number;
  start_time: string | null;
};

type StoredLeg = { id: string; americanOdds: number };

// Closing line: look the pick's id up in the latest scan snapshot.
async function buildClosingLookup(): Promise<(pick: PickRow) => Promise<number | null>> {
  const db = (() => {
    try {
      return getSupabaseAdmin();
    } catch {
      return null;
    }
  })();

  let latest: Map<string, number> | null = null;
  if (db) {
    try {
      const { data } = await db
        .from('odds_scans')
        .select('legs')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const legs = (data?.legs as StoredLeg[] | undefined) ?? [];
      latest = new Map(legs.map((l) => [l.id, l.americanOdds]));
    } catch {
      latest = null;
    }
  }

  return async (pick) => latest?.get(pick.id) ?? null;
}

type ScoreEvent = {
  id: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{ name: string; score: string }> | null;
};

const ODDS_SPORTS = [
  'baseball_mlb',
  'basketball_wnba',
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl',
];

// Result grading via completed scores (moneyline only).
async function buildResultLookup(): Promise<
  (pick: PickRow) => Promise<'win' | 'loss' | 'push' | null>
> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return async () => null;

  const winners = new Map<string, string>(); // "away @ home" -> winning team

  await Promise.all(
    ODDS_SPORTS.map(async (sport) => {
      try {
        const { data } = await axios.get<ScoreEvent[]>(
          `https://api.the-odds-api.com/v4/sports/${sport}/scores`,
          { params: { apiKey, daysFrom: 3 }, timeout: 10000 },
        );
        for (const ev of data) {
          if (!ev.completed || !ev.scores) continue;
          const home = ev.scores.find((s) => s.name === ev.home_team);
          const away = ev.scores.find((s) => s.name === ev.away_team);
          if (!home || !away) continue;
          const hs = Number(home.score);
          const as = Number(away.score);
          if (!Number.isFinite(hs) || !Number.isFinite(as) || hs === as) continue;
          winners.set(`${ev.away_team} @ ${ev.home_team}`, hs > as ? ev.home_team : ev.away_team);
        }
      } catch {
        // skip this sport
      }
    }),
  );

  return async (pick) => {
    if (pick.market !== 'moneyline') return null; // only grade moneylines for now
    const winner = winners.get(pick.event);
    if (!winner) return null;
    // pick format: "<Team> ML"
    const team = pick.pick.replace(/\s+ML$/, '').trim();
    if (!team) return null;
    return winner === team ? 'win' : 'loss';
  };
}

export async function runSettlement(): Promise<{ closingCaptured: number; graded: number }> {
  const closingLookup = await buildClosingLookup();
  const resultLookup = await buildResultLookup();

  const closingCaptured = await captureClosingLines(closingLookup);
  const graded = await gradeSettledPicks(resultLookup);

  return { closingCaptured, graded };
}
