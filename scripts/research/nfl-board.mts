/**
 * NFL Sunday board: every DraftKings/FanDuel player prop next to the usage
 * model, with the market's no-vig chance, a blend (market moved 30% toward the
 * model), and Fliff's price on the same prop.
 *
 *   npx tsx scripts/research/nfl-board.mts <YYYY-MM-DD> <oddsapi-nfl-*.json>...
 *
 * Writes data/research/prop-sheets/nfl-board-{date}.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { PropStat } from '../../lib/research/nfl-props';
import { nameKey, TEAM_NAMES } from '../../lib/research/nflverse';
import { nflWeekProjections, usageChanceOver, USAGE_MODEL_NAME } from '../../lib/research/nfl-usage';

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
  rows.push({
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
console.log('\nFliff prices that beat the market (EV ≥ +3%):');
for (const r of [...rows].filter((x) => !x.flagged && x.fliff && x.fliff.ev >= 0.03).sort((a, b) => b.fliff!.ev - a.fliff!.ev).slice(0, 25))
  console.log(`  ${r.player.padEnd(22)} ${r.side} ${r.fliff!.line} ${r.label.padEnd(10)} Fliff ${r.fliff!.price > 0 ? '+' : ''}${r.fliff!.price} · chance ${pct(r.fliff!.chance)} · EV +${(100 * r.fliff!.ev).toFixed(1)}%  (DK ${r.line}, mkt ${pct(r.market)})`);
