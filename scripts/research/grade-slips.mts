/**
 * Grade every tracked slip in data/research/slips/*.json against box scores and
 * write data/research/slips/track.json (record, units, expected vs actual wins).
 *
 *   npx tsx scripts/research/grade-slips.mts
 *
 * Legs: NFL (nflverse), NHL (NHL stats API), NBA/WNBA (sportsdataverse), matched by
 * player name and game date. A leg with no box score yet is pending.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { playerGames, seasonFor } from '../../lib/research/hoops-data';
import { nameKey, nhlGoalieGames, nhlSeasonFor, nhlSkaterGames } from '../../lib/research/nhl-data';
import { playerWeeks, schedule } from '../../lib/research/nflverse';

const DIR = 'data/research/slips';
type Leg = { sport: string; game: string; gameDate: string; player: string; team: string; stat: string; side: 'over' | 'under'; line: number; ours: number };
type Slip = { id: string; title: string; payout: { type: string; multiplier: number }; combined: { ours: number }; legs: Leg[] };

const NFL_COL: Record<string, string> = { receptions: 'receptions', recYds: 'receiving_yards', rushYds: 'rushing_yards', carries: 'carries', passYds: 'passing_yards', passAtt: 'attempts', passTd: 'passing_tds', targets: 'targets' };

async function actual(leg: Leg): Promise<number | null> {
  const day = new Date(`${leg.gameDate}T12:00:00Z`);
  const key = nameKey(leg.player);
  if (leg.sport === 'NFL') {
    const season = day.getUTCMonth() < 3 ? day.getUTCFullYear() - 1 : day.getUTCFullYear();
    const games = await schedule(season);
    const ids = new Set(games.filter((g) => g.gameday === leg.gameDate && g.homeScore != null).map((g) => g.gameId));
    const row = (await playerWeeks(season)).find((w) => ids.has(w.gameId) && nameKey(w.name) === key);
    return row ? Number(row[NFL_COL[leg.stat]] ?? 0) : null;
  }
  if (leg.sport === 'NHL') {
    const season = nhlSeasonFor(day);
    if (leg.stat === 'saves') {
      const g = (await nhlGoalieGames(season)).find((r) => r.date === leg.gameDate && nameKey(r.name) === key);
      return g ? g.saves : null;
    }
    const s = (await nhlSkaterGames(season)).find((r) => r.date === leg.gameDate && nameKey(r.name) === key);
    return s ? Number(s[leg.stat as 'shots']) : null;
  }
  if (leg.sport === 'NBA' || leg.sport === 'WNBA') {
    const league = leg.sport === 'NBA' ? 'nba' : 'wnba';
    const g = (await playerGames(league, seasonFor(league, day)).catch(() => [])).find((r) => r.date === leg.gameDate && nameKey(r.name) === key);
    if (!g) return null;
    return leg.stat === 'pra' ? g.pts + g.reb + g.ast : Number(g[leg.stat as 'pts']);
  }
  return null;
}

const slips = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'track.json').sort().map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as Slip);
const graded = [];
for (const slip of slips) {
  const legs = [];
  for (const leg of slip.legs) {
    const a = await actual(leg);
    legs.push({ ...leg, actual: a, result: a == null ? 'pending' : (leg.side === 'under' ? a < leg.line : a > leg.line) ? 'hit' : 'miss' });
  }
  const result = legs.some((l) => l.result === 'miss') ? 'lost' : legs.every((l) => l.result === 'hit') ? 'won' : 'pending';
  graded.push({ id: slip.id, title: slip.title, multiplier: slip.payout.multiplier, chance: slip.combined.ours, result, legs });
  console.log(`${slip.id}: ${result.toUpperCase()} · ${legs.map((l) => `${l.player} ${l.side} ${l.line} → ${l.actual ?? '?'} ${l.result}`).join(' | ')}`);
}
const done = graded.filter((s) => s.result !== 'pending');
const won = done.filter((s) => s.result === 'won');
const summary = {
  updatedAt: new Date().toISOString(),
  slips: graded.length,
  settled: done.length,
  won: won.length,
  // Units at 1 per slip: a win returns the multiplier.
  units: Math.round((won.reduce((a, s) => a + s.multiplier, 0) - done.length) * 100) / 100,
  expectedWins: Math.round(done.reduce((a, s) => a + s.chance, 0) * 100) / 100,
  legs: { settled: done.flatMap((s) => s.legs).filter((l) => l.result !== 'pending').length, hit: graded.flatMap((s) => s.legs).filter((l) => l.result === 'hit').length },
  graded,
};
writeFileSync(`${DIR}/track.json`, JSON.stringify(summary, null, 1));
console.log(`\n${summary.won}/${summary.settled} slips won · ${summary.units} units · expected wins ${summary.expectedWins}`);
