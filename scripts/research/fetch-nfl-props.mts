/**
 * One pull of NFL player props from The Odds API (DraftKings, FanDuel, Fliff),
 * saved raw so it's paid for once. Cost: markets × games (the three books count
 * as one region). Writes data/research/lines/oddsapi-nfl-{stamp}.json.
 *
 *   npx tsx scripts/research/fetch-nfl-props.mts [YYYY-MM-DD last day to include] [team name filter]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  ['.env.local', '.env'].flatMap((f) => { try { return readFileSync(f, 'utf8').split('\n'); } catch { return []; } })
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].replace(/^"|"$/g, '')]),
);
const KEY = process.env.ODDS_API_KEY ?? env.ODDS_API_KEY;
if (!KEY) throw new Error('ODDS_API_KEY missing');
const until = process.argv[2] ?? new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
const API = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl';
const MARKETS = ['player_pass_yds', 'player_pass_attempts', 'player_pass_tds', 'player_rush_yds', 'player_rush_attempts', 'player_receptions', 'player_reception_yds'];

const events = (await fetch(`${API}/events?apiKey=${KEY}`).then((r) => r.json())) as Array<{ id: string; commence_time: string; home_team: string; away_team: string }>;
const now = Date.now();
const only = process.argv[3]?.toLowerCase();
const pick = events.filter((e) => Date.parse(e.commence_time) > now && e.commence_time.slice(0, 10) <= until && (!only || `${e.away_team} ${e.home_team}`.toLowerCase().includes(only)));
console.log(`${pick.length} games through ${until}`);
const out = [];
let remaining = '';
for (const e of pick) {
  const res = await fetch(`${API}/events/${e.id}/odds?apiKey=${KEY}&regions=us&bookmakers=draftkings,fanduel,fliff&markets=${MARKETS.join(',')}&oddsFormat=american`);
  remaining = res.headers.get('x-requests-remaining') ?? remaining;
  if (!res.ok) {
    console.log(`  ${e.away_team} @ ${e.home_team}: HTTP ${res.status} ${await res.text()}`);
    continue;
  }
  const j = await res.json();
  out.push(j);
  console.log(`  ${e.away_team} @ ${e.home_team}: ${(j.bookmakers ?? []).map((b: { key: string; markets: unknown[] }) => `${b.key} ${b.markets.length}`).join(', ')}`);
}
const stamp = new Date().toISOString();
const path = `data/research/lines/oddsapi-nfl-${stamp.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}.json`;
if (existsSync(path)) throw new Error(`${path} exists`);
writeFileSync(path, JSON.stringify({ savedAt: stamp, events: out }));
console.log(`saved ${path} · credits left ${remaining}`);
