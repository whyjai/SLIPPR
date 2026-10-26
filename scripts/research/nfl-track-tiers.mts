/**
 * Track the cheat sheet's tiers (lib/research/nfl-tiers.ts) as singles cards for grade-slips.mts:
 * data/research/slips/{date}-nfl-best.json (best bets) and {date}-nfl-confirmed.json (all confirmed plays).
 * Run it whenever the sheet is published. On a re-pull, legs whose game has kicked off stay as they
 * were; the rest are replaced by the current board, so each card matches what the sheet said before each game.
 *
 *   npx tsx scripts/research/nfl-track-tiers.mts <nfl-board-*.json> [week label]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BEST_BETS, CONFIRMED_MAX, nflTiers } from '../../lib/research/nfl-tiers';

const [FILE, WEEK = 'Week 7'] = process.argv.slice(2);
const board = JSON.parse(readFileSync(FILE, 'utf8'));
const now = Date.now();
const etDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

type Leg = { kickoff: string; game: string; player: string; [k: string]: unknown };
const toLeg = (r: any): Leg => ({
  sport: 'NFL', game: r.game, gameDate: etDate(r.kickoff), kickoff: r.kickoff, player: r.player, team: r.team, stat: r.stat, label: r.label,
  side: r.side, line: r.line, ours: r.blend, market: r.market, price: r.best.price, book: r.best.book, ev: r.best.ev, checks: r.checks, why: r.why.lines,
});

const { confirmed, best } = nflTiers(board.rows, now);
if (!confirmed.length) throw new Error('no confirmed plays on this board');
const date = etDate(confirmed.map((r) => r.kickoff).sort()[0]);

function track(id: string, title: string, fresh: Leg[], max: number, oneKey: 'game' | 'player') {
  const path = `data/research/slips/${id}.json`;
  const old = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const kept: Leg[] = (old?.legs ?? []).filter((l: Leg) => Date.parse(l.kickoff) <= now);
  const taken = new Set(kept.map((l) => l[oneKey]));
  const legs = [...kept, ...fresh.filter((l) => !taken.has(l[oneKey]))].slice(0, max);
  const card = { id, title, createdAt: old?.createdAt ?? new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), board: FILE, payout: { type: 'singles', multiplier: 0 }, combined: { ours: 0 }, legs };
  writeFileSync(path, JSON.stringify(card, null, 1));
  console.log(`${path}: ${kept.length} kept (kicked off), ${legs.length - kept.length} from this board`);
  for (const l of legs) console.log(`  ${l.player} ${l.side} ${l.line} ${l.label} · ${l.book} ${l.price} · EV ${(100 * (l.ev as number)).toFixed(1)}%${kept.includes(l) ? ' (kept)' : ''}`);
}

track(`${date}-nfl-best`, `NFL ${WEEK} best bets (top ${BEST_BETS} confirmed, one per game), singles`, best.map(toLeg), BEST_BETS, 'game');
track(`${date}-nfl-confirmed`, `NFL ${WEEK} confirmed props (no failed check), singles`, confirmed.map(toLeg), CONFIRMED_MAX, 'player');
