/**
 * One pull of NFL game lines (moneyline, spread, total) for every upcoming game
 * from The Odds API: DraftKings, FanDuel, Fliff. Cost: 3 credits (markets × one region).
 * Writes data/research/lines/oddsapi-nfl-games-{stamp}.json.
 *
 *   npx tsx scripts/research/fetch-nfl-games.mts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  ['.env.local', '.env'].flatMap((f) => { try { return readFileSync(f, 'utf8').split('\n'); } catch { return []; } })
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].replace(/^"|"$/g, '')]),
);
const KEY = process.env.ODDS_API_KEY ?? env.ODDS_API_KEY;
if (!KEY) throw new Error('ODDS_API_KEY missing');
const res = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?apiKey=${KEY}&regions=us&bookmakers=draftkings,fanduel,fliff&markets=h2h,spreads,totals&oddsFormat=american`);
if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
const events = await res.json();
const stamp = new Date().toISOString();
const path = `data/research/lines/oddsapi-nfl-games-${stamp.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}.json`;
if (existsSync(path)) throw new Error(`${path} exists`);
writeFileSync(path, JSON.stringify({ savedAt: stamp, events }));
console.log(`${events.length} games · saved ${path} · credits used ${res.headers.get('x-requests-last')} · left ${res.headers.get('x-requests-remaining')}`);
