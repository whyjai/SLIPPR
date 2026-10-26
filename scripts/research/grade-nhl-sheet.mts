/**
 * Track the NHL prop cheat sheet: freeze it before puck drop, grade it against
 * the game logs, and write a track record.
 *
 *   npx tsx scripts/research/grade-nhl-sheet.mts snapshot
 *   npx tsx scripts/research/grade-nhl-sheet.mts track     # grade every snapshot → nhl-track.json
 *
 * Snapshots: data/research/prop-sheets/nhl-{YYYY-MM-DD}.json (the slate's date).
 * Graded by date and NHL player id (the sheet's game ids may be ESPN's on a fallback day).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { nhlGoalieGames, nhlSkaterGames } from '../../lib/research/nhl-data';
import { getNhlPropSheet, type NhlPropSheet } from '../../lib/research/nhl-props';
import { printSummary, summarize, type GradedProp } from '../../lib/research/prop-grading';

const [mode] = process.argv.slice(2);
const DIR = 'data/research/prop-sheets';

if (mode === 'snapshot') {
  const sheet = await getNhlPropSheet();
  if (!sheet.date || !sheet.games.length) {
    console.log('nothing to snapshot');
  } else {
    const path = `${DIR}/nhl-${sheet.date}.json`;
    writeFileSync(path, JSON.stringify({ ...sheet, snapshotAt: new Date().toISOString() }, null, 1));
    console.log(`saved ${path}: ${sheet.games.length} games`);
  }
} else if (mode === 'track') {
  const files = readdirSync(DIR).filter((f) => f.startsWith('nhl-2') && f.endsWith('.json')).sort();
  const boxes = new Map<number, { rows: Map<string, Record<string, number>>; teamDays: Set<string> }>();
  const box = async (season: number) => {
    if (!boxes.has(season)) {
      const [sk, gk] = await Promise.all([nhlSkaterGames(season), nhlGoalieGames(season)]);
      const rows = new Map<string, Record<string, number>>();
      for (const g of sk) rows.set(`${g.date}|${g.playerId}`, { shots: g.shots, points: g.points, goals: g.goals, assists: g.assists });
      for (const g of gk) rows.set(`${g.date}|${g.playerId}`, { saves: g.saves });
      boxes.set(season, { rows, teamDays: new Set(sk.map((g) => `${g.date}|${g.team}`)) });
    }
    return boxes.get(season)!;
  };
  const all: GradedProp[] = [];
  const days: Array<{ date: string; pending: number; dnp: number } & ReturnType<typeof summarize>> = [];
  for (const f of files) {
    const sheet = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as NhlPropSheet;
    const { rows, teamDays } = await box(sheet.season);
    const graded: GradedProp[] = [];
    let pending = 0, dnp = 0;
    for (const g of sheet.games) {
      for (const side of g.sides) {
        for (const p of side.players) {
          if (!teamDays.has(`${sheet.date}|${side.team}`)) {
            pending += p.props.length;
            continue;
          }
          // A goalie who didn't start (or a scratched skater) has no line: not graded.
          const row = rows.get(`${sheet.date}|${p.id}`);
          if (!row || (p.pos?.startsWith('G') && !row.saves)) {
            dnp += p.props.length;
            continue;
          }
          for (const pr of p.props) {
            const actual = row[pr.stat] ?? 0;
            graded.push({ key: `nhl|${pr.stat}`, name: p.name, base: pr.base, median: pr.median, low: pr.low, high: pr.high, actual, lines: pr.lines.map((l) => ({ ...l, over: actual > l.line })) });
          }
        }
      }
    }
    const s = summarize(graded);
    printSummary(`NHL ${sheet.date}`, s, pending, dnp);
    days.push({ date: sheet.date!, pending, dnp, ...s });
    all.push(...graded);
  }
  const overall = summarize(all);
  printSummary('NHL overall', overall);
  writeFileSync(`${DIR}/nhl-track.json`, JSON.stringify({ league: 'nhl', updatedAt: new Date().toISOString(), overall, days }, null, 1));
} else {
  throw new Error('usage: grade-nhl-sheet.mts <snapshot|track>');
}
