/**
 * Closing-line value of saved NFL picks: for each row of an early snapshot
 * (data/research/lines/nfl-*.json, written by nfl-picks.mts), Pinnacle's no-vig
 * chance of the same side in the last snapshot before kickoff. Beating the close
 * is the earliest reliable sign that picks are good; results take hundreds of bets.
 *
 *   npx tsx scripts/research/clv.mts <snapshot.json> [min ours] [min pinnacle]
 */
import { readdirSync, readFileSync } from 'node:fs';

type Row = { player: string; market: string; line: number; side: 'over' | 'under'; ours: number; pinnacle: number; pinnacleOver: number; pinnacleId: string; kickoff: string };
const [file, minOurs = '0.58', minPin = '0.55'] = process.argv.slice(2);
const open = JSON.parse(readFileSync(file, 'utf8')) as { savedAt: string; rows: Row[] };
const snaps = readdirSync('data/research/lines')
  .filter((f) => f.startsWith('nfl-') && f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`data/research/lines/${f}`, 'utf8')) as { savedAt: string; rows: Row[] })
  .filter((s) => s.savedAt > open.savedAt)
  .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
let n = 0, sum = 0, beat = 0;
for (const r of open.rows.filter((x) => x.ours >= Number(minOurs) && x.pinnacle >= Number(minPin))) {
  // Last snapshot before his kickoff with the same Pinnacle prop at the same line.
  const close = [...snaps].reverse().find((s) => s.savedAt < r.kickoff && s.rows.some((x) => x.pinnacleId === r.pinnacleId && x.line === r.line));
  const c = close?.rows.find((x) => x.pinnacleId === r.pinnacleId && x.line === r.line);
  if (!c) {
    console.log(`  ${r.player} ${r.side} ${r.line} ${r.market}: no closing line at this number`);
    continue;
  }
  const closeSide = r.side === 'over' ? c.pinnacleOver : 1 - c.pinnacleOver;
  const clv = closeSide - r.pinnacle;
  n++;
  sum += clv;
  if (clv > 0) beat++;
  console.log(`  ${r.player.padEnd(22)} ${r.side} ${String(r.line).padStart(6)} ${r.market.padEnd(16)} picked ${(100 * r.pinnacle).toFixed(1)}% → close ${(100 * closeSide).toFixed(1)}%  ${clv >= 0 ? '+' : ''}${(100 * clv).toFixed(1)}`);
}
console.log(`\n${n} picks with a closing line · beat the close ${beat}/${n} · average ${n ? ((100 * sum) / n).toFixed(2) : '—'} points`);
