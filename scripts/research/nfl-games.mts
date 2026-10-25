/**
 * NFL game model: margin and total ratings (Elo-style, updated on each result,
 * regressed between seasons), walk-forward backtested against the closing
 * spread and total in nflverse games.csv. The prediction is the market moved
 * part way toward the ratings, by the weight that scored best out of sample.
 *
 *   npx tsx scripts/research/nfl-games.mts <season> <week> [oddsapi-nfl-games-*.json]
 *
 * With a game-odds file (scripts/research/fetch-nfl-games.mts) it also prices
 * every DraftKings/FanDuel/Fliff moneyline, spread and total and picks the best bet per game.
 * Writes data/research/prop-sheets/nfl-games-{season}-w{week}.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { schedule, TEAM_NAMES, type Game } from '../../lib/research/nflverse';

const [SEASON, WEEK, ODDS] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const FIRST = 2006;
const games: Game[] = [];
for (let s = FIRST; s <= SEASON; s++) games.push(...(await schedule(s)));
games.sort((a, b) => a.season - b.season || a.week - b.week || a.gameday.localeCompare(b.gameday));

type Params = { k: number; kt: number; carry: number; hfa: number; cap: number };
const MARGIN_SD = 13.5, TOTAL_SD = 13;
const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Walk forward through every game; returns each game's pre-game rating prediction. */
function run(p: Params) {
  const r = new Map<string, number>(), off = new Map<string, number>(), def = new Map<string, number>();
  const preds = new Map<string, { margin: number; total: number }>();
  let season = FIRST, avg = 43;
  for (const g of games) {
    if (g.season !== season) {
      for (const m of [r, off, def]) for (const [t, v] of m) m.set(t, v * p.carry);
      season = g.season;
    }
    const margin = (r.get(g.home) ?? 0) - (r.get(g.away) ?? 0) + (g.neutral ? 0 : p.hfa);
    const total = avg + (off.get(g.home) ?? 0) + (off.get(g.away) ?? 0) + (def.get(g.home) ?? 0) + (def.get(g.away) ?? 0);
    preds.set(g.gameId, { margin, total });
    if (g.homeScore == null || g.awayScore == null) continue;
    const err = Math.max(-p.cap, Math.min(p.cap, g.homeScore - g.awayScore - margin));
    r.set(g.home, (r.get(g.home) ?? 0) + (p.k * err) / 2);
    r.set(g.away, (r.get(g.away) ?? 0) - (p.k * err) / 2);
    const te = g.homeScore + g.awayScore - total;
    // Points scored: offense of the scorer, defense of the opponent.
    const hErr = g.homeScore - (avg / 2 + (off.get(g.home) ?? 0) + (def.get(g.away) ?? 0));
    const aErr = g.awayScore - (avg / 2 + (off.get(g.away) ?? 0) + (def.get(g.home) ?? 0));
    off.set(g.home, (off.get(g.home) ?? 0) + (p.kt * hErr) / 2); def.set(g.away, (def.get(g.away) ?? 0) + (p.kt * hErr) / 2);
    off.set(g.away, (off.get(g.away) ?? 0) + (p.kt * aErr) / 2); def.set(g.home, (def.get(g.home) ?? 0) + (p.kt * aErr) / 2);
    avg += 0.004 * te;
  }
  return { preds, r };
}

const graded = (from: number, to: number) => games.filter((g) => g.season >= from && g.season <= to && g.homeScore != null && g.spreadLine != null && g.totalLine != null && g.season >= FIRST + 2);
/** Blend weight that minimizes squared error vs results, and the resulting error. */
function fitWeight(preds: Map<string, { margin: number; total: number }>, gs: Game[], key: 'margin' | 'total') {
  let num = 0, den = 0;
  for (const g of gs) {
    const mkt = key === 'margin' ? g.spreadLine! : g.totalLine!;
    const act = key === 'margin' ? g.homeScore! - g.awayScore! : g.homeScore! + g.awayScore!;
    const d = preds.get(g.gameId)![key] - mkt;
    num += d * (act - mkt); den += d * d;
  }
  return Math.max(0, num / den);
}
function score(preds: Map<string, { margin: number; total: number }>, gs: Game[], key: 'margin' | 'total', w: number) {
  let se = 0, seMkt = 0, picks = 0, wins = 0;
  for (const g of gs) {
    const mkt = key === 'margin' ? g.spreadLine! : g.totalLine!;
    const act = key === 'margin' ? g.homeScore! - g.awayScore! : g.homeScore! + g.awayScore!;
    const blend = mkt + w * (preds.get(g.gameId)![key] - mkt);
    se += (act - blend) ** 2; seMkt += (act - mkt) ** 2;
    const edge = preds.get(g.gameId)![key] - mkt;
    if (Math.abs(edge) >= 3 && act !== mkt) { picks++; if (Math.sign(edge) === Math.sign(act - mkt)) wins++; }
  }
  return { rmse: Math.sqrt(se / gs.length), rmseMkt: Math.sqrt(seMkt / gs.length), picks, hitRate: picks ? wins / picks : null };
}

// Tune on 2008-2018, test 2019-2025.
const train = graded(2008, 2018), test = graded(2019, SEASON);
let best: { p: Params; e: number } | null = null;
for (const k of [0.04, 0.06, 0.08, 0.1]) for (const carry of [0.5, 0.65, 0.8]) for (const hfa of [1.5, 2, 2.5]) for (const cap of [14, 21]) {
  const p = { k, kt: 0.08, carry, hfa, cap };
  const { preds } = run(p);
  const e = train.reduce((a, g) => a + (g.homeScore! - g.awayScore! - preds.get(g.gameId)!.margin) ** 2, 0);
  if (!best || e < best.e) best = { p, e };
}
let bestKt = { kt: 0.08, e: Infinity };
for (const kt of [0.03, 0.05, 0.08, 0.12]) {
  const { preds } = run({ ...best!.p, kt });
  const e = train.reduce((a, g) => a + (g.homeScore! + g.awayScore! - preds.get(g.gameId)!.total) ** 2, 0);
  if (e < bestKt.e) bestKt = { kt, e };
}
const P = { ...best!.p, kt: bestKt.kt };
const { preds, r } = run(P);
const wM = fitWeight(preds, train, 'margin'), wT = fitWeight(preds, train, 'total');
const testM = score(preds, test, 'margin', wM), testT = score(preds, test, 'total', wT);
console.log('params', P, `blend weight spread ${wM.toFixed(2)} total ${wT.toFixed(2)}`);
console.log(`test 2019-${SEASON}: spread RMSE blend ${testM.rmse.toFixed(3)} vs market ${testM.rmseMkt.toFixed(3)} · 3+ pt disagreements ATS ${testM.picks} picks, ${(100 * testM.hitRate!).toFixed(1)}%`);
console.log(`                total  RMSE blend ${testT.rmse.toFixed(3)} vs market ${testT.rmseMkt.toFixed(3)} · 3+ pt disagreements O/U ${testT.picks} picks, ${(100 * testT.hitRate!).toFixed(1)}%`);

// Win-chance calibration on the test seasons: blended margin through the normal curve vs how often that side won.
const bins = new Map<number, { n: number; p: number; won: number }>();
for (const g of test) {
  if (g.homeScore === g.awayScore) continue;
  const m = g.spreadLine! + wM * (preds.get(g.gameId)!.margin - g.spreadLine!);
  const pFav = Phi(Math.abs(m) / MARGIN_SD), favWon = Math.sign(g.homeScore! - g.awayScore!) === Math.sign(m || 1);
  const k = Math.min(9, Math.floor(pFav * 10));
  const b = bins.get(k) ?? { n: 0, p: 0, won: 0 };
  b.n++; b.p += pFav; b.won += Number(favWon); bins.set(k, b);
}
console.log('win chance calibration (favorite): ' + [...bins].sort((a, b) => a[0] - b[0]).map(([, b]) => `${Math.round((100 * b.p) / b.n)}%→${Math.round((100 * b.won) / b.n)}% (${b.n})`).join(', '));

// This week.
const week = games.filter((g) => g.season === SEASON && g.week === WEEK && g.homeScore == null);
type Odds = { home_team: string; away_team: string; commence_time: string; bookmakers: Array<{ key: string; markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point?: number }> }> }> };
const odds: Odds[] = ODDS ? JSON.parse(readFileSync(ODDS, 'utf8')).events : [];
const full = (abbr: string) => `${TEAM_NAMES[abbr].city} ${TEAM_NAMES[abbr].nickname}`;
const implied = (am: number) => (am < 0 ? -am / (-am + 100) : 100 / (am + 100));
const decimal = (am: number) => (am < 0 ? 1 + 100 / -am : 1 + am / 100);
const BOOKS = ['draftkings', 'fanduel', 'fliff'];

const out = [];
for (const g of week) {
  const pr = preds.get(g.gameId)!;
  const ev = odds.find((e) => e.home_team === full(g.home) && e.away_team === full(g.away));
  // Market: DK/FD consensus main spread and total if we have book odds, else nflverse's line.
  const consensus = (mkey: string, pick: (o: { name: string; point?: number }) => boolean) => {
    const pts = (ev?.bookmakers ?? []).filter((b) => b.key !== 'fliff').flatMap((b) => b.markets.filter((m) => m.key === mkey).flatMap((m) => m.outcomes.filter(pick).map((o) => o.point!)));
    return pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null;
  };
  const homeSpread = consensus('spreads', (o) => o.name === full(g.home));
  const mktMargin = homeSpread != null ? -homeSpread : g.spreadLine!;
  const mktTotal = consensus('totals', (o) => o.name === 'Over') ?? g.totalLine!;
  const margin = mktMargin + wM * (pr.margin - mktMargin);
  const total = mktTotal + wT * (pr.total - mktTotal);
  const homeWin = Phi(margin / MARGIN_SD);
  // Chance of each outcome: DK/FD no-vig price at that exact line when both books' two sides exist, moved by how much the
  // blend shifts the normal-curve chance; otherwise the normal curve around the blended margin/total.
  const fairAt = (mkey: string, name: string, point?: number) => {
    const fs: number[] = [];
    for (const b of ev?.bookmakers ?? []) {
      if (b.key === 'fliff') continue;
      const m = b.markets.find((x) => x.key === mkey);
      const mine = m?.outcomes.find((o) => o.name === name && o.point === point);
      const other = m?.outcomes.find((o) => o.name !== name && (mkey !== 'spreads' || o.point === -point!) && (mkey !== 'totals' || o.point === point));
      if (mine && other) fs.push(implied(mine.price) / (implied(mine.price) + implied(other.price)));
    }
    return fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : null;
  };
  const curve = (mkey: string, name: string, point: number | undefined, m: number, t: number) => {
    const isHome = name === full(g.home);
    if (mkey === 'h2h') return isHome ? Phi(m / MARGIN_SD) : 1 - Phi(m / MARGIN_SD);
    if (mkey === 'spreads') return Phi(((isHome ? m : -m) + point!) / MARGIN_SD);
    const z = (t - point!) / TOTAL_SD;
    return name === 'Over' ? Phi(z) : 1 - Phi(z);
  };
  const bets = [];
  for (const b of ev?.bookmakers ?? []) {
    if (!BOOKS.includes(b.key)) continue;
    for (const m of b.markets) for (const o of m.outcomes) {
      const isHome = o.name === full(g.home);
      const team = isHome ? g.home : g.away;
      const label = m.key === 'h2h' ? `${team} ML` : m.key === 'spreads' ? `${team} ${o.point! > 0 ? '+' : ''}${o.point}` : `${o.name} ${o.point}`;
      const fair = fairAt(m.key, o.name, o.point);
      const shift = curve(m.key, o.name, o.point, margin, total) - curve(m.key, o.name, o.point, mktMargin, mktTotal);
      const p = Math.min(0.99, Math.max(0.01, fair != null ? fair + shift : curve(m.key, o.name, o.point, margin, total)));
      const pm = fair ?? curve(m.key, o.name, o.point, mktMargin, mktTotal);
      bets.push({ market: m.key, label, book: b.key, price: o.price, chance: Math.round(p * 1000) / 1000, fair: fair != null, marketEv: Math.round((pm * decimal(o.price) - 1) * 1000) / 1000, ev: Math.round((p * decimal(o.price) - 1) * 1000) / 1000, breakeven: Math.round(implied(o.price) * 1000) / 1000 });
    }
  }
  // Best price per bet across books, then the best bet in each market.
  const byLabel = new Map<string, (typeof bets)[number]>();
  for (const b of bets) { const k = `${b.market}|${b.label}`; if (!byLabel.has(k) || b.ev > byLabel.get(k)!.ev) byLabel.set(k, b); }
  const bestPer = (mk: string) => [...byLabel.values()].filter((b) => b.market === mk && (mk !== 'h2h' || true)).sort((a, b) => b.ev - a.ev)[0] ?? null;
  const row = {
    game: `${g.away} @ ${g.home}`, gameday: g.gameday, gametime: g.gametime, neutral: g.neutral, qbs: { [g.away]: g.awayQb, [g.home]: g.homeQb },
    market: { homeMargin: Math.round(mktMargin * 10) / 10, total: Math.round(mktTotal * 10) / 10 },
    ratings: { homeMargin: Math.round(pr.margin * 10) / 10, total: Math.round(pr.total * 10) / 10 },
    pred: {
      homeMargin: Math.round(margin * 10) / 10, total: Math.round(total * 10) / 10, homeWin: Math.round(homeWin * 1000) / 1000,
      score: { [g.away]: Math.round((total - margin) / 2), [g.home]: Math.round((total + margin) / 2) },
      winner: margin >= 0 ? g.home : g.away,
    },
    best: { h2h: bestPer('h2h'), spreads: bestPer('spreads'), totals: bestPer('totals') },
  };
  out.push(row);
  const f = (b: (typeof bets)[number] | null) => (b ? `${b.label} ${b.book} ${b.price > 0 ? '+' : ''}${b.price} (${Math.round(100 * b.chance)}%, EV ${(100 * b.ev).toFixed(1)}%)` : '—');
  console.log(`\n${row.game} ${g.gameday} ${g.gametime} · mkt ${g.home} ${mktMargin > 0 ? '-' : '+'}${Math.abs(mktMargin).toFixed(1)} O/U ${mktTotal} · ratings ${pr.margin.toFixed(1)} / ${pr.total.toFixed(1)}`);
  console.log(`  pred ${g.away} ${row.pred.score[g.away]} - ${g.home} ${row.pred.score[g.home]} · ${row.pred.winner} wins ${Math.round(100 * Math.max(homeWin, 1 - homeWin))}%`);
  console.log(`  ML ${f(row.best.h2h)} · spread ${f(row.best.spreads)} · total ${f(row.best.totals)}`);
}
const ratings = [...r].sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${v.toFixed(1)}`).join(', ');
console.log(`\nratings (pts vs avg): ${ratings}`);
const file = `data/research/prop-sheets/nfl-games-${SEASON}-w${WEEK}.json`;
writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), params: P, weights: { spread: wM, total: wT }, test: { spread: testM, total: testT }, games: out }, null, 1));
console.log(`wrote ${file}`);
