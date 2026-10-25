/**
 * This week's NFL prop board: the usage model (lib/research/nfl-usage.ts) next
 * to Pinnacle's no-vig price on the same line, and a saved copy of the lines so
 * picks can be scored against the closing line later (closing-line value).
 *
 *   npx tsx scripts/research/nfl-picks.mts [YYYY-MM-DD]
 *
 * Writes data/research/lines/nfl-{date}-{HHMM}.json.
 */
import { writeFileSync } from 'node:fs';
import { fetchPinnaclePlayerProps } from '../../lib/prop-edges';
import { nameKey, TEAM_NAMES } from '../../lib/research/nflverse';
import { nflWeekProjections, usageChanceOver, USAGE_MODEL_NAME } from '../../lib/research/nfl-usage';
import type { PropStat } from '../../lib/research/nfl-props';

// Ranking: start from the sharp price and move only part of the way toward the model. Picking legs
// where a model is most confident selects its errors (our first 18 tracked legs: model said ~65%,
// they hit 56%, Pinnacle had said ~59%), so the model's view is shrunk toward the market.
const MODEL_WEIGHT = 0.3;
const MAX_GAP = 0.15; // bigger model-vs-market gaps usually mean the model is missing news

const asOf = process.argv[2] ?? new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const MARKET: Record<string, PropStat> = {
  Receptions: 'receptions', 'Receiving Yards': 'recYds', 'Rushing Yards': 'rushYds', 'Rush Attempts': 'carries',
  'Passing Yards': 'passYds', 'Pass Attempts': 'passAtt', 'Touchdown Passes': 'passTd', Targets: 'targets',
};

const games = await nflWeekProjections(2026, asOf);
const byName = new Map<string, { g: (typeof games)[number]; p: (typeof games)[number]['sides'][number]['players'][number] }>();
for (const g of games) for (const s of g.sides) for (const p of s.players) byName.set(nameKey(p.name), { g, p });
const nick = (abbr: string) => TEAM_NAMES[abbr]?.nickname ?? abbr;

const pin = (await fetchPinnaclePlayerProps()).filter((x) => x.sport === 'NFL');
const rows = [];
const unmatched = new Set<string>();
for (const x of pin) {
  const stat = MARKET[x.market];
  if (!stat) continue;
  const hit = byName.get(nameKey(x.player));
  if (!hit) {
    unmatched.add(x.player);
    continue;
  }
  if (!x.event.includes(nick(hit.p.team))) continue;
  const proj = hit.p.proj[stat];
  if (proj == null) continue;
  const over = usageChanceOver(hit.p.pos, stat, proj, x.line);
  if (over == null) continue;
  const side = over >= 0.5 ? 'over' : 'under';
  const ours = side === 'over' ? over : 1 - over;
  const sharp = side === 'over' ? x.overProb : 1 - x.overProb;
  rows.push({
    game: `${hit.g.away} @ ${hit.g.home}`, gameday: hit.g.gameday, kickoff: x.startTime, player: hit.p.name, team: hit.p.team, pos: hit.p.pos, injury: hit.p.injury,
    stat, market: x.market, line: x.line, proj: Math.round(proj * 10) / 10, side, ours: Math.round(ours * 1000) / 1000, pinnacle: Math.round(sharp * 1000) / 1000, pinnacleOver: x.overProb, pinnacleId: x.id,
    blend: Math.round((sharp + MODEL_WEIGHT * (ours - sharp)) * 1000) / 1000, flagged: Math.abs(ours - sharp) > MAX_GAP,
  });
}
rows.sort((a, b) => Number(a.flagged) - Number(b.flagged) || b.blend - a.blend);
const stamp = new Date().toISOString();
const path = `data/research/lines/nfl-${stamp.slice(0, 10)}-${stamp.slice(11, 16).replace(':', '')}.json`;
writeFileSync(path, JSON.stringify({ model: USAGE_MODEL_NAME, asOf, savedAt: stamp, rows }, null, 1));
console.log(`${games.length} games · ${pin.length} Pinnacle NFL props · ${rows.length} matched · unmatched players: ${[...unmatched].slice(0, 15).join(', ')}`);
console.log(`saved ${path}\n`);
for (const g of games) for (const s of g.sides) if (s.out.length) console.log(`${s.team} missing: ${s.out.join(', ')}`);
console.log('');
for (const r of rows) console.log(`${r.flagged ? '!' : ' '}${String(Math.round(100 * r.blend)).padStart(3)}% blend ${String(Math.round(100 * r.ours)).padStart(3)}% ours ${String(Math.round(100 * r.pinnacle)).padStart(3)}% pin  ${r.game.padEnd(10)} ${r.player.padEnd(22)} ${r.side.padEnd(5)} ${String(r.line).padStart(6)} ${r.market.padEnd(16)} proj ${r.proj}${r.injury ? ` [${r.injury}]` : ''}`);
