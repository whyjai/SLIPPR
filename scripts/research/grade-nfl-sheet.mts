/**
 * Grade the NFL prop cheat sheet against what happened.
 *
 *   npx tsx scripts/research/grade-nfl-sheet.mts snapshot 2026 [YYYY-MM-DD]  # freeze the sheet (default: today, ET)
 *   npx tsx scripts/research/grade-nfl-sheet.mts grade 2026 6               # grade week 6's frozen sheets
 *   npx tsx scripts/research/grade-nfl-sheet.mts track 2026                 # grade every week, write {season}-track.json
 *   npx tsx scripts/research/grade-nfl-sheet.mts backtest 2026 4 5          # rebuild weeks 4-5 as of their Thursday and grade
 *
 * Snapshots live in data/research/prop-sheets/{season}-w{week}-{asOf}.json; each
 * game is graded against the last snapshot taken on or before its game day. Results
 * come from nflverse box scores (they match ESPN's: validate-nfl.mts); games
 * not in them yet are reported as pending, players without a stat line as DNP.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getNflPropSheet, STAT_COL, type NflPropSheet, type PropStat } from '../../lib/research/nfl-props';
import { playerWeeks, schedule } from '../../lib/research/nflverse';

const [mode, seasonArg, a, b] = process.argv.slice(2);
const season = Number(seasonArg);
const DIR = 'data/research/prop-sheets';
const ww = (week: number) => String(week).padStart(2, '0');
const file = (week: number, asOf: string) => `${DIR}/${season}-w${ww(week)}-${asOf}.json`;
type Snapshot = NflPropSheet & { asOf: string; snapshotAt?: string };
const snapshots = (week: number): Snapshot[] =>
  readdirSync(DIR)
    .filter((f) => f.startsWith(`${season}-w${ww(week)}-`) && f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as Snapshot);
const todayEt = () => new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);

type Graded = {
  week: number;
  name: string;
  team: string;
  stat: PropStat;
  season: number; // his average going in
  median: number;
  low: number;
  high: number;
  actual: number;
  lines: Array<{ line: number; chance: number; hits: number; games: number; over: boolean }>;
};

/** Merge a week's snapshots: each game from the last snapshot taken on or before its game day. */
function mergeSnapshots(list: Snapshot[], gameday: Map<string, string>): NflPropSheet {
  const games = new Map<string, NflPropSheet['games'][number]>();
  for (const snap of [...list].sort((x, y) => x.asOf.localeCompare(y.asOf))) {
    for (const g of snap.games) if (snap.asOf <= (gameday.get(g.gameId) ?? '9999')) games.set(g.gameId, g);
  }
  return { ...list[list.length - 1], games: [...games.values()] };
}

async function grade(sheet: NflPropSheet): Promise<{ graded: Graded[]; pending: number; dnp: number }> {
  const [weeks, games] = await Promise.all([playerWeeks(season), schedule(season)]);
  const rows = new Map(weeks.filter((w) => w.seasonType === 'REG' && w.week === sheet.week).map((w) => [w.playerId, w]));
  const teamsIn = new Set([...rows.values()].map((w) => w.team));
  const final = new Set(games.filter((g) => g.week === sheet.week && g.homeScore != null).map((g) => g.gameId));
  const graded: Graded[] = [];
  let pending = 0;
  let dnp = 0;
  for (const g of sheet.games) {
    // Wait for the game to be final and its box score published.
    const done = final.has(g.gameId) && teamsIn.has(g.home) && teamsIn.has(g.away);
    for (const side of g.sides) {
      for (const p of side.players) {
        if (!done) {
          pending += p.props.length;
          continue;
        }
        const w = rows.get(p.id);
        if (!w) {
          dnp += p.props.length;
          continue;
        }
        for (const pr of p.props) {
          const actual = Number(w[STAT_COL[pr.stat]] ?? 0);
          graded.push({
            week: sheet.week ?? 0,
            name: p.name,
            team: p.team,
            stat: pr.stat,
            season: pr.season,
            median: pr.median,
            low: pr.low,
            high: pr.high,
            actual,
            lines: pr.lines.map((l) => ({ ...l, over: actual > l.line })),
          });
        }
      }
    }
  }
  return { graded, pending, dnp };
}

function summary(graded: Graded[]) {
  const lines = graded.flatMap((g) => g.lines);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const share = (n: number, d: number) => (d ? r3(n / d) : null);
  const brier = (p: (l: (typeof lines)[number]) => number) => (lines.length ? r3(lines.reduce((s, l) => s + (p(l) - (l.over ? 1 : 0)) ** 2, 0) / lines.length) : null);
  const bins = [[0, 30], [30, 45], [45, 55], [55, 70], [70, 101]].map(([lo, hi]) => {
    const b = lines.filter((l) => l.chance >= lo && l.chance < hi);
    return { from: lo, to: Math.min(hi, 100), said: b.length ? Math.round(b.reduce((s, l) => s + l.chance, 0) / b.length) : null, happened: share(b.filter((l) => l.over).length, b.length), n: b.length };
  });
  return {
    props: graded.length,
    lines: lines.length,
    overMedian: share(graded.filter((g) => g.actual > g.median).length, graded.length),
    underAverage: share(graded.filter((g) => g.actual < g.season).length, graded.length),
    insideMiddle50: share(graded.filter((g) => g.actual >= g.low && g.actual <= g.high).length, graded.length),
    brier: { sheet: brier((l) => l.chance / 100), ownHitRate: brier((l) => (l.games ? l.hits / l.games : 0.5)), coinFlip: brier(() => 0.5) },
    calibration: bins,
  };
}

function report(label: string, graded: Graded[], pending: number, dnp: number) {
  const pct = (x: number, n: number) => (n ? `${((100 * x) / n).toFixed(1)}%` : '—');
  const lines = graded.flatMap((g) => g.lines.map((l) => ({ ...l, g })));
  const brier = (p: (l: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + (p(l) - (l.over ? 1 : 0)) ** 2, 0) / (lines.length || 1);
  console.log(`\n=== ${label}: ${graded.length} props graded (${lines.length} lines) · ${pending} pending · ${dnp} DNP`);
  if (!graded.length) return;
  console.log(`Median: actual over the median ${pct(graded.filter((g) => g.actual > g.median).length, graded.length)} (target 50%)`);
  console.log(`Average: actual under his season average ${pct(graded.filter((g) => g.actual < g.season).length, graded.length)} (sheet says lines at the average go under more often)`);
  console.log(`Middle 50%: inside the range ${pct(graded.filter((g) => g.actual >= g.low && g.actual <= g.high).length, graded.length)} (target 50%)`);
  console.log(
    `Chance over, Brier score (lower is better): sheet ${brier((l) => l.chance / 100).toFixed(4)} · his own hit rate ${brier((l) => (l.games ? l.hits / l.games : 0.5)).toFixed(4)} · coin flip ${brier(() => 0.5).toFixed(4)}`,
  );
  console.log('Calibration (sheet said → happened):');
  for (const [lo, hi] of [[0, 30], [30, 45], [45, 55], [55, 70], [70, 101]]) {
    const bin = lines.filter((l) => l.chance >= lo && l.chance < hi);
    if (bin.length) console.log(`   ${lo}-${Math.min(hi, 100)}%: said ${(bin.reduce((s, l) => s + l.chance, 0) / bin.length).toFixed(0)}% → ${pct(bin.filter((l) => l.over).length, bin.length)} (n=${bin.length})`);
  }
  const byStat = new Map<string, Graded[]>();
  for (const g of graded) byStat.set(g.stat, [...(byStat.get(g.stat) ?? []), g]);
  console.log('By stat (over median · inside middle 50% · n):');
  for (const [stat, gs] of byStat) {
    console.log(`   ${stat.padEnd(10)} ${pct(gs.filter((g) => g.actual > g.median).length, gs.length).padStart(6)} · ${pct(gs.filter((g) => g.actual >= g.low && g.actual <= g.high).length, gs.length).padStart(6)} · ${gs.length}`);
  }
}

if (mode === 'snapshot') {
  const asOf = a ?? todayEt();
  const sheet = await getNflPropSheet(season, { asOf, status: true });
  if (!sheet.week || !sheet.games.length) {
    console.log(`nothing to snapshot as of ${asOf}`);
  } else {
    writeFileSync(file(sheet.week, asOf), JSON.stringify({ ...sheet, asOf, snapshotAt: new Date().toISOString() }, null, 1));
    console.log(`saved ${file(sheet.week, asOf)}: week ${sheet.week}, ${sheet.games.length} games`);
  }
} else if (mode === 'grade' || mode === 'track') {
  const games = await schedule(season);
  const gameday = new Map(games.map((g) => [g.gameId, g.gameday]));
  const weeksWithSnapshots = [...new Set(readdirSync(DIR).filter((f) => f.startsWith(`${season}-w`)).map((f) => Number(f.slice(6, 8))))].sort((x, y) => x - y);
  const todo = mode === 'grade' ? [Number(a)] : weeksWithSnapshots;
  const track: Array<{ week: number; snapshots: string[]; pending: number; dnp: number } & ReturnType<typeof summary>> = [];
  const all: Graded[] = [];
  for (const week of todo) {
    const list = snapshots(week);
    if (!list.length) throw new Error(`no snapshots for ${season} week ${week}`);
    const { graded, pending, dnp } = await grade(mergeSnapshots(list, gameday));
    report(`Week ${week} sheet (snapshots ${list.map((x) => x.asOf).join(', ')})`, graded, pending, dnp);
    track.push({ week, snapshots: list.map((x) => x.asOf), pending, dnp, ...summary(graded) });
    all.push(...graded);
    if (mode === 'grade') {
      const misses = [...graded].sort((x, y) => Math.abs(y.actual - y.median) / (y.median || 1) - Math.abs(x.actual - x.median) / (x.median || 1));
      console.log('Biggest surprises:', misses.slice(0, 6).map((g) => `${g.name} ${g.stat} ${g.actual} vs median ${g.median}`).join(' | '));
    }
  }
  if (mode === 'track') {
    // Weeks before the first live snapshot: rebuilt as of each week's first game day (no injury report).
    const rebuilt: typeof track = [];
    const firstLive = weeksWithSnapshots[0] ?? 99;
    const rebuiltGraded: Graded[] = [];
    for (let week = 4; week < firstLive; week++) {
      const first = games.filter((g) => g.gameType === 'REG' && g.week === week).map((g) => g.gameday).sort()[0];
      if (!first) continue;
      const { graded, pending, dnp } = await grade(await getNflPropSheet(season, { asOf: first }));
      rebuilt.push({ week, snapshots: [`rebuilt as of ${first}`], pending, dnp, ...summary(graded) });
      rebuiltGraded.push(...graded);
    }
    const out = {
      season,
      updatedAt: new Date().toISOString(),
      overall: summary(all),
      weeks: track,
      rebuilt: { note: 'Weeks before tracking began, rebuilt from only earlier games (no injury report).', overall: summary(rebuiltGraded), weeks: rebuilt },
    };
    writeFileSync(`${DIR}/${season}-track.json`, JSON.stringify(out, null, 1));
    console.log(`\nwrote ${DIR}/${season}-track.json`);
  }
} else if (mode === 'backtest') {
  const all: Graded[] = [];
  let pend = 0, dnps = 0;
  const games = await schedule(season);
  for (let week = Number(a); week <= Number(b ?? a); week++) {
    const first = games.filter((g) => g.gameType === 'REG' && g.week === week).map((g) => g.gameday).sort()[0];
    const sheet = await getNflPropSheet(season, { asOf: first });
    const { graded, pending, dnp } = await grade(sheet);
    report(`Backtest week ${week} (as of ${first})`, graded, pending, dnp);
    all.push(...graded);
    pend += pending;
    dnps += dnp;
  }
  if (Number(b) > Number(a)) report(`Backtest weeks ${a}-${b} combined`, all, pend, dnps);
} else {
  console.log('usage: grade-nfl-sheet.mts snapshot <season> <YYYY-MM-DD> | grade <season> <week> | backtest <season> <from> <to>');
}
