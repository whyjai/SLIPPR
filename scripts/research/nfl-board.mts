/**
 * NFL Sunday board: every DraftKings/FanDuel player prop next to the usage
 * model, with the market's no-vig chance, a blend (market moved 30% toward the
 * model), and Fliff's price on the same prop. Each prop carries its receipts: the
 * player's game log against the line, his role, what the opponent allows his
 * position, the game script, and six checks that each pass, fail or stay neutral.
 *
 *   npx tsx scripts/research/nfl-board.mts <YYYY-MM-DD> <oddsapi-nfl-*.json>...
 *
 * Writes data/research/prop-sheets/nfl-board-{date}.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { PropStat } from '../../lib/research/nfl-props';
import { nameKey, TEAM_NAMES } from '../../lib/research/nflverse';
import { defenseVsPosition, nflUsageData, nflWeekProjections, statValue, usageChanceOver, USAGE_MODEL_NAME } from '../../lib/research/nfl-usage';

const MODEL_WEIGHT = 0.3; // how far to move from the market toward the model
const MAX_GAP = 0.15; // flag: model and market this far apart usually means the model is missing news

const [asOf, ...files] = process.argv.slice(2);
const MARKET: Record<string, PropStat> = {
  player_pass_yds: 'passYds', player_pass_attempts: 'passAtt', player_pass_tds: 'passTd', player_rush_yds: 'rushYds',
  player_rush_attempts: 'carries', player_receptions: 'receptions', player_reception_yds: 'recYds',
};
const LABEL: Record<PropStat, string> = { passYds: 'Pass Yds', passAtt: 'Pass Att', passTd: 'Pass TDs', rushYds: 'Rush Yds', carries: 'Rush Att', receptions: 'Receptions', recYds: 'Rec Yds', targets: 'Targets' };

type Outcome = { name: 'Over' | 'Under'; description: string; price: number; point: number };
type Event = { home_team: string; away_team: string; commence_time: string; bookmakers: Array<{ key: string; markets: Array<{ key: string; outcomes: Outcome[] }> }> };
const events = files.flatMap((f) => (JSON.parse(readFileSync(f, 'utf8')) as { events: Event[] }).events);

const implied = (am: number) => (am < 0 ? -am / (-am + 100) : 100 / (am + 100));
const decimal = (am: number) => (am < 0 ? 1 + 100 / -am : 1 + am / 100);
/** Per book: player|stat → line → { over, under } American prices. */
type Quote = { over?: number; under?: number };
const quotes = new Map<string, Map<string, Map<number, Quote>>>(); // book → key → line → quote
const gameOf = new Map<string, Event>();
for (const e of events) {
  for (const b of e.bookmakers) {
    const byKey = quotes.get(b.key) ?? quotes.set(b.key, new Map()).get(b.key)!;
    for (const m of b.markets) {
      const stat = MARKET[m.key];
      if (!stat) continue;
      for (const o of m.outcomes) {
        const k = `${nameKey(o.description)}|${stat}`;
        gameOf.set(k, e);
        const lines = byKey.get(k) ?? byKey.set(k, new Map()).get(k)!;
        const q = lines.get(o.point) ?? {};
        q[o.name === 'Over' ? 'over' : 'under'] = o.price;
        lines.set(o.point, q);
      }
    }
  }
}
const fairOver = (q: Quote | undefined) => (q?.over != null && q.under != null ? implied(q.over) / (implied(q.over) + implied(q.under)) : null);
/** The book's main line: the two-way line closest to even money. */
const mainLine = (lines: Map<number, Quote> | undefined) =>
  lines ? [...lines].filter(([, q]) => q.over != null && q.under != null).sort((a, b) => Math.abs(fairOver(a[1])! - 0.5) - Math.abs(fairOver(b[1])! - 0.5))[0]?.[0] ?? null : null;

// Starting QBs: the ones the books post passing-yard props for.
const starters = new Set([...(quotes.get('draftkings')?.keys() ?? []), ...(quotes.get('fanduel')?.keys() ?? [])].filter((k) => k.endsWith('|passYds')).map((k) => k.split('|')[0]));
const games = await nflWeekProjections(2026, asOf, { starters });
const players = new Map<string, { g: (typeof games)[number]; p: (typeof games)[number]['sides'][number]['players'][number]; opp: string }>();
for (const g of games) for (const s of g.sides) for (const p of s.players) players.set(nameKey(p.name), { g, p, opp: s.team === g.home ? g.away : g.home });
const nick = (abbr: string) => TEAM_NAMES[abbr]?.nickname ?? abbr;

// Receipts: this season's game logs and what each defense has allowed each position before this week.
const week = games[0]?.week ?? 1;
const season = await nflUsageData(2026);
const logs = new Map<string, typeof season.players>();
for (const g of season.players) if (g.week < week && g.snap > 0) (logs.get(g.id) ?? logs.set(g.id, []).get(g.id)!).push(g);
for (const l of logs.values()) l.sort((a, b) => a.week - b.week);
const dvp = defenseVsPosition(season.players, week);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const UNIT: Record<PropStat, string> = { passYds: 'pass yds', passAtt: 'pass att', passTd: 'pass TDs', rushYds: 'rush yds', carries: 'carries', receptions: 'rec', recYds: 'rec yds', targets: 'targets' };
type Check = 'pass' | 'fail' | 'neutral';
const fmt = (x: number) => (Math.abs(x) >= 10 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString());

const rows = [];
const unmatched = new Set<string>();
const keys = new Set([...(quotes.get('draftkings')?.keys() ?? []), ...(quotes.get('fanduel')?.keys() ?? [])]);
for (const k of keys) {
  const [nk, stat] = k.split('|') as [string, PropStat];
  const hit = players.get(nk);
  const e = gameOf.get(k)!;
  if (!hit || !`${e.away_team} ${e.home_team}`.includes(nick(hit.p.team))) {
    unmatched.add(nk);
    continue;
  }
  const proj = hit.p.proj[stat];
  if (proj == null) continue;
  const dk = quotes.get('draftkings')?.get(k), fd = quotes.get('fanduel')?.get(k), fl = quotes.get('fliff')?.get(k);
  const line = mainLine(dk) ?? mainLine(fd);
  if (line == null) continue;
  const fairs = [fairOver(dk?.get(line)), fairOver(fd?.get(line))].filter((x): x is number => x != null);
  const market = fairs.reduce((a, b) => a + b, 0) / fairs.length;
  const ours = usageChanceOver(hit.p.pos, stat, proj, line);
  if (ours == null) continue;
  const blendOver = market + MODEL_WEIGHT * (ours - market);
  const side = blendOver >= 0.5 ? 'over' : 'under';
  const s = (x: number) => (side === 'over' ? x : 1 - x);
  // Fliff: its main line and price for this side; chance there = market at the DK line, shifted by the model's slope.
  const fLine = mainLine(fl);
  let fliff = null;
  if (fLine != null) {
    const price = fl!.get(fLine)![side];
    const oursF = usageChanceOver(hit.p.pos, stat, proj, fLine);
    if (price != null && oursF != null) {
      const pF = s(blendOver + (oursF - ours));
      fliff = { line: fLine, price, chance: Math.round(pF * 1000) / 1000, ev: Math.round((pF * decimal(price) - 1) * 1000) / 1000 };
    }
  }
  // Line shopping: the best price for this side at this line across the books, and its expected value.
  const offers = (['draftkings', 'fanduel', 'fliff'] as const)
    .map((book) => ({ book, price: quotes.get(book)?.get(k)?.get(line)?.[side] }))
    .filter((o): o is { book: 'draftkings' | 'fanduel' | 'fliff'; price: number } => o.price != null)
    .sort((a, b) => decimal(b.price) - decimal(a.price));
  const best = offers[0] ? { ...offers[0], ev: Math.round((s(blendOver) * decimal(offers[0].price) - 1) * 1000) / 1000 } : null;
  // --- Receipts and checks for the side we'd play.
  const over = side === 'over';
  const log = logs.get(hit.p.id) ?? [];
  const vals = log.map((g) => statValue(g, stat));
  const hits = vals.filter((v) => (over ? v > line : v < line)).length;
  const last5 = vals.slice(-5), hits5 = last5.filter((v) => (over ? v > line : v < line)).length;
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const snapL3 = log.slice(-3).reduce((a, g) => a + g.snap, 0) / Math.max(1, Math.min(3, log.length));
  const d = dvp.get(`${hit.opp}|${hit.p.pos}|${stat}`);
  const sideInfo = hit.g.sides.find((x) => x.team === hit.p.team)!;
  const teamSpread = hit.g.spread == null ? null : hit.p.team === hit.g.home ? hit.g.spread : -hit.g.spread; // + = favored
  const rushStat = stat === 'rushYds' || stat === 'carries';
  const yardStat = stat === 'passYds' || stat === 'recYds';
  // Game script: favorites run more; underdogs throw more; yardage follows the team's implied points.
  let script: Check = 'neutral', scriptWhy = '';
  if (rushStat && hit.p.pos === 'QB') {
    // QB runs are scrambles and designed runs, not clock-killing carries: no script read.
  } else if (rushStat && teamSpread != null && Math.abs(teamSpread) >= 1.5) {
    const up = teamSpread > 0;
    script = up === over ? 'pass' : 'fail';
    scriptWhy = `${hit.p.team} ${up ? 'favored' : 'underdog'} by ${Math.abs(teamSpread)}: ${up ? 'more' : 'fewer'} late carries`;
  } else if (!rushStat && !yardStat && teamSpread != null && Math.abs(teamSpread) >= 1.5) {
    const up = teamSpread < 0;
    script = up === over ? 'pass' : 'fail';
    scriptWhy = `${hit.p.team} ${up ? 'underdog' : 'favored'} by ${Math.abs(teamSpread)}: ${up ? 'more' : 'less'} passing`;
  } else if (yardStat && sideInfo.implied != null && Math.abs(sideInfo.implied - 22.5) >= 1.5) {
    const up = sideInfo.implied > 22.5;
    script = up === over ? 'pass' : 'fail';
    scriptWhy = `${hit.p.team} implied ${sideInfo.implied.toFixed(1)} pts (${up ? 'above' : 'below'} the 22.5 average)`;
  }
  const checks: Record<string, Check> = {
    model: s(ours) >= 0.52 ? 'pass' : s(ours) < 0.5 ? 'fail' : 'neutral',
    market: s(market) >= 0.5 ? 'pass' : s(market) < 0.47 ? 'fail' : 'neutral',
    form: vals.length < 3 ? 'neutral' : hits / vals.length >= 0.55 ? 'pass' : hits / vals.length <= 0.45 ? 'fail' : 'neutral',
    matchup: !d ? 'neutral' : d.ratio >= 1.05 ? (over ? 'pass' : 'fail') : d.ratio <= 0.95 ? (over ? 'fail' : 'pass') : 'neutral',
    script,
    health: hit.p.injury && hit.p.injury !== 'Active' ? 'fail' : 'pass',
  };
  const allowsMost = d && d.rank <= 16;
  const why = {
    log: last5, games: vals.length, hits, hits5, avg: avg == null ? null : Math.round(avg * 10) / 10,
    targetShare: Math.round(hit.p.shares.tgt * 1000) / 10, carryShare: Math.round(hit.p.shares.car * 1000) / 10, snapL3: Math.round(snapL3 * 100),
    matchup: d ? { perGame: Math.round(d.perGame * 10) / 10, league: Math.round(d.league * 10) / 10, rank: d.rank, ratio: Math.round(d.ratio * 100) / 100 } : null,
    implied: sideInfo.implied, teamSpread, teammatesOut: sideInfo.out,
    lines: [
      `Projection ${fmt(proj)} vs line ${line} · our chance ${Math.round(100 * s(ours))}%, market ${Math.round(100 * s(market))}%`,
      vals.length ? `${over ? 'Over' : 'Under'} ${line} in ${hits} of ${vals.length} games (last 5: ${last5.map(fmt).join(', ')}) · avg ${fmt(avg!)}` : 'No games this season',
      d ? `${hit.opp} allows ${fmt(d.perGame)} ${UNIT[stat]}/g to ${hit.p.pos}s, ${allowsMost ? ordinal(d.rank) + ' most' : ordinal(33 - d.rank) + ' fewest'} (avg ${fmt(d.league)})` : '',
      [hit.p.pos === 'QB' ? '' : `${Math.round(hit.p.shares.tgt * 100)}% of targets${hit.p.shares.car > 0.05 ? `, ${Math.round(hit.p.shares.car * 100)}% of carries` : ''} · ${Math.round(snapL3 * 100)}% snaps last 3`, scriptWhy, sideInfo.out.length ? `out: ${sideInfo.out.join(', ')}` : ''].filter(Boolean).join(' · '),
    ].filter(Boolean),
  };
  rows.push({
    checks, passes: Object.values(checks).filter((c) => c === 'pass').length, fails: Object.values(checks).filter((c) => c === 'fail').length, why,
    best,
    game: `${hit.g.away} @ ${hit.g.home}`, kickoff: e.commence_time, player: hit.p.name, team: hit.p.team, opp: hit.opp, pos: hit.p.pos, injury: hit.p.injury,
    stat, label: LABEL[stat], line, proj: Math.round(proj * 10) / 10, side,
    market: Math.round(s(market) * 1000) / 1000, ours: Math.round(s(ours) * 1000) / 1000, blend: Math.round(s(blendOver) * 1000) / 1000,
    flagged: Math.abs(ours - market) > MAX_GAP, books: fairs.length,
    dk: dk?.get(line) ? { over: dk.get(line)!.over, under: dk.get(line)!.under } : null, fliff,
  });
}
rows.sort((a, b) => Number(a.flagged) - Number(b.flagged) || (b.best?.ev ?? -1) - (a.best?.ev ?? -1));
const out = `data/research/prop-sheets/nfl-board-${asOf}.json`;
writeFileSync(out, JSON.stringify({ model: USAGE_MODEL_NAME, modelWeight: MODEL_WEIGHT, generatedAt: new Date().toISOString(), games: games.map((g) => ({ game: `${g.away} @ ${g.home}`, gameday: g.gameday, gametime: g.gametime, total: g.total, spread: g.spread, out: Object.fromEntries(g.sides.map((s) => [s.team, s.out])) })), rows }, null, 1));
console.log(`${rows.length} props · unmatched ${[...unmatched].slice(0, 12).join(', ')} · wrote ${out}\n`);
const pct = (x: number) => `${Math.round(100 * x)}%`.padStart(4);
console.log('  EV  blend mkt  ours  game        player                 side   line  prop        proj   best price');
for (const r of rows.slice(0, 45)) console.log(`${r.flagged ? '!' : ' '}${r.best ? `${(100 * r.best.ev).toFixed(1)}%`.padStart(6) : '     —'} ${pct(r.blend)} ${pct(r.market)} ${pct(r.ours)}  ${r.game.padEnd(10)} ${r.player.padEnd(22)} ${r.side.padEnd(5)} ${String(r.line).padStart(6)}  ${r.label.padEnd(10)} ${String(r.proj).padStart(6)}  ${r.best ? `${r.best.book} ${r.best.price > 0 ? '+' : ''}${r.best.price}` : '—'}${r.injury && r.injury !== 'Active' ? ` [${r.injury}]` : ''}`);
console.log('\nTop plays with receipts (no failed check, 4+ passed):');
const mark = (c: string) => (c === 'pass' ? '+' : c === 'fail' ? 'x' : '.');
for (const r of rows.filter((x) => !x.flagged && x.best && x.best.ev > 0 && x.fails === 0 && x.passes >= 4).slice(0, 15)) {
  console.log(`  ${r.player} ${r.side} ${r.line} ${r.label} · ${r.best!.book} ${r.best!.price} EV ${(100 * r.best!.ev).toFixed(1)}% · checks ${Object.entries(r.checks).map(([k, c]) => `${k}${mark(c)}`).join(' ')}`);
  for (const l of r.why.lines) console.log(`      ${l}`);
}
console.log('\nFliff prices that beat the market (EV ≥ +3%):');
for (const r of [...rows].filter((x) => !x.flagged && x.fliff && x.fliff.ev >= 0.03).sort((a, b) => b.fliff!.ev - a.fliff!.ev).slice(0, 25))
  console.log(`  ${r.player.padEnd(22)} ${r.side} ${r.fliff!.line} ${r.label.padEnd(10)} Fliff ${r.fliff!.price > 0 ? '+' : ''}${r.fliff!.price} · chance ${pct(r.fliff!.chance)} · EV +${(100 * r.fliff!.ev).toFixed(1)}%  (DK ${r.line}, mkt ${pct(r.market)})`);
