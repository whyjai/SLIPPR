/**
 * Track the basketball prop cheat sheet: freeze it before tip-off, grade it
 * against the box scores, and write a track record.
 *
 *   npx tsx scripts/research/grade-hoops-sheet.mts snapshot nba
 *   npx tsx scripts/research/grade-hoops-sheet.mts track nba        # grade every snapshot → {league}-track.json
 *   npx tsx scripts/research/grade-hoops-sheet.mts replay nba       # rebuild each snapshot's players with today's model, then grade
 *
 * Snapshots: data/research/prop-sheets/{league}-{YYYY-MM-DD}.json (the slate's
 * date). Box scores: sportsdataverse (ESPN game ids, the same ids as the sheet).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isLeague, playerGames, seasonFor, type HoopsPlayerGame, type League } from '../../lib/research/hoops-data';
import { getHoopsPropSheet, hoopsPlayerProps, hoopsStat, spreadOf, type HoopsPropSheet } from '../../lib/research/hoops-props';
import { printSummary, summarize, type GradedProp } from '../../lib/research/prop-grading';

const [mode, arg] = process.argv.slice(2);
if (!arg || !isLeague(arg)) throw new Error('usage: grade-hoops-sheet.mts <snapshot|track|replay> <nba|wnba>');
const league: League = arg;
const DIR = 'data/research/prop-sheets';

if (mode === 'snapshot') {
  const sheet = await getHoopsPropSheet(league);
  if (!sheet.date || !sheet.games.length) {
    console.log('nothing to snapshot');
  } else {
    const path = `${DIR}/${league}-${sheet.date}.json`;
    writeFileSync(path, JSON.stringify({ ...sheet, snapshotAt: new Date().toISOString() }, null, 1));
    console.log(`saved ${path}: ${sheet.games.length} games`);
  }
} else if (mode === 'track' || mode === 'replay') {
  const files = readdirSync(DIR).filter((f) => f.startsWith(`${league}-2`) && f.endsWith('.json')).sort();
  const boxes = new Map<number, Map<string, HoopsPlayerGame>>(); // season → `${gameId}|${playerId}`
  const box = async (season: number) => {
    if (!boxes.has(season)) boxes.set(season, new Map((await playerGames(league, season).catch(() => [])).map((g) => [`${g.gameId}|${g.playerId}`, g])));
    return boxes.get(season)!;
  };
  const all: GradedProp[] = [];
  const days: Array<{ date: string; pending: number; dnp: number } & ReturnType<typeof summarize>> = [];
  const byPlayer = (rows: Iterable<HoopsPlayerGame>) => {
    const m = new Map<string, HoopsPlayerGame[]>();
    for (const g of rows) (m.get(g.playerId) ?? m.set(g.playerId, []).get(g.playerId)!).push(g);
    for (const l of m.values()) l.sort((a, b) => a.date.localeCompare(b.date));
    return m;
  };
  for (const f of files) {
    const sheet = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as HoopsPropSheet;
    const season = sheet.season ?? seasonFor(league);
    const rows = await box(season);
    if (mode === 'replay') {
      // Same players, props rebuilt from the games before the slate (what the sheet would say today).
      const before = [...rows.values()].filter((g) => g.date < sheet.date!);
      const nowBy = byPlayer(before);
      const prevBy = byPlayer((await box(season - 1)).values());
      for (const g of sheet.games) {
        for (const side of g.sides) {
          const teamGames = new Set(before.filter((x) => x.team === side.team).map((x) => x.gameId)).size;
          for (const p of side.players) {
            p.props = hoopsPlayerProps(league, spreadOf(league), { team: side.team, teamGames, games: nowBy.get(p.id) ?? [], prior: prevBy.get(p.id) ?? [] })?.props ?? [];
          }
        }
      }
    }
    const gamesIn = new Set([...rows.keys()].map((k) => k.split('|')[0]));
    const graded: GradedProp[] = [];
    let pending = 0, dnp = 0;
    for (const g of sheet.games) {
      for (const side of g.sides) {
        for (const p of side.players) {
          if (!gamesIn.has(g.id)) {
            pending += p.props.length;
            continue;
          }
          const row = rows.get(`${g.id}|${p.id}`);
          if (!row) {
            dnp += p.props.length;
            continue;
          }
          for (const pr of p.props) {
            const actual = hoopsStat(row, pr.stat);
            graded.push({ key: `${league}|${pr.stat}`, name: p.name, base: pr.base, median: pr.median, low: pr.low, high: pr.high, actual, lines: pr.lines.map((l) => ({ ...l, over: actual > l.line })) });
          }
        }
      }
    }
    const s = summarize(graded);
    printSummary(`${league.toUpperCase()} ${sheet.date}`, s, pending, dnp);
    days.push({ date: sheet.date!, pending, dnp, ...s });
    all.push(...graded);
  }
  const overall = summarize(all);
  printSummary(`${league.toUpperCase()} overall${mode === 'replay' ? ' (replayed with today\'s model)' : ''}`, overall);
  if (mode === 'track') writeFileSync(`${DIR}/${league}-track.json`, JSON.stringify({ league, updatedAt: new Date().toISOString(), overall, days }, null, 1));
} else {
  throw new Error('usage: grade-hoops-sheet.mts <snapshot|track|replay> <nba|wnba>');
}
