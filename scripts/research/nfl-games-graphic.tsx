/* eslint-disable */
// Renders the NFL game predictions (scripts/research/nfl-games.mts) as 1080x1350 PNGs (early games, then late and night):
// a card per game with the predicted score, win chance, and the best price for moneyline, spread and total.
//   npx tsx scripts/research/nfl-games-graphic.tsx <nfl-games-*.json> <output dir> [week label]
import { readFileSync, writeFileSync } from 'node:fs';
import React from 'react';
import { ImageResponse } from 'next/og';

const [FILE, OUT, WEEK = 'WEEK 7'] = process.argv.slice(2);
const data = JSON.parse(readFileSync(FILE, 'utf8'));
const FONT = (f: string) => readFileSync(`${process.cwd()}/assets/fonts/${f}`);
const fonts = [500, 600, 700, 800].map((w) => ({ name: 'Geist', data: FONT(`Geist-${w}.ttf`), weight: w as 500, style: 'normal' as const }))
  .concat([500, 600].map((w) => ({ name: 'Geist Mono', data: FONT(`GeistMono-${w}.ttf`), weight: w as 500, style: 'normal' as const })));
const BG = '#070709', FG = '#fafafa', MUTED = '#a1a1aa', DIM = '#71717a', BRIGHT = '#34d399', AMBER = '#fcd34d';
const BOOK: Record<string, string> = { draftkings: 'DK', fanduel: 'FD', fliff: 'Fliff' };
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const timeLabel = (day: string, t: string) => {
  const [h, m] = t.split(':').map(Number);
  const wd = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${wd} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const lastName = (n: string) => n.replace(/ (Jr\.|Sr\.|II|III)$/, '').split(' ').slice(-1)[0];

type Bet = { label: string; book: string; price: number; chance: number; ev: number } | null;
const games = [...data.games].sort((a: any, b: any) => (a.gameday + a.gametime).localeCompare(b.gameday + b.gametime));
const top = games.map((g: any) => ({ g, b: (['h2h', 'spreads', 'totals'] as const).map((k) => g.best[k]).filter(Boolean).sort((x: any, y: any) => y.ev - x.ev)[0] }));

function BetLine({ kind, b }: { kind: string; b: Bet }) {
  if (!b) return <div style={{ display: 'flex', fontSize: 15, color: DIM }}>{`${kind} —`}</div>;
  const edge = b.ev > 0;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 15 }}>
      <span style={{ display: 'flex', width: 52, color: DIM, fontSize: 13, letterSpacing: 1 }}>{kind}</span>
      <span style={{ display: 'flex', width: 172, color: edge ? BRIGHT : FG, fontWeight: 700 }}>{b.label.replace(' ML', '')}</span>
      <span style={{ display: 'flex', width: 112, fontFamily: 'Geist Mono', fontSize: 14, color: MUTED }}>{`${BOOK[b.book]} ${am(b.price)}`}</span>
      <span style={{ display: 'flex', width: 88, justifyContent: 'flex-end', fontFamily: 'Geist Mono', fontSize: 14, color: edge ? BRIGHT : DIM }}>{`${b.ev > 0 ? '+' : ''}${(100 * b.ev).toFixed(1)}%`}</span>
    </div>
  );
}

function Card({ g }: { g: any }) {
  const [away, home] = g.game.split(' @ ');
  const win = g.pred.winner === home ? g.pred.homeWin : 1 - g.pred.homeWin;
  const spread = g.market.homeMargin;
  const fav = spread >= 0 ? home : away;
  const anyEdge = ['h2h', 'spreads', 'totals'].some((k) => g.best[k]?.ev > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 474, padding: '12px 16px', borderRadius: 14, background: anyEdge ? 'rgba(52,211,153,0.07)' : 'rgba(255,255,255,0.035)', border: `1px solid ${anyEdge ? 'rgba(52,211,153,0.35)' : 'rgba(255,255,255,0.07)'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, color: DIM, fontFamily: 'Geist Mono' }}>{`${timeLabel(g.gameday, g.gametime)} ET${g.neutral ? ' · PARIS' : ''}`}</span>
        <span style={{ fontSize: 13, color: DIM, fontFamily: 'Geist Mono' }}>{`${fav} -${Math.abs(spread)} · O/U ${g.market.total}`}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: g.pred.winner === away ? FG : MUTED }}>{`${away} ${g.pred.score[away]}`}</span>
          <span style={{ fontSize: 18, color: DIM }}>@</span>
          <span style={{ fontSize: 26, fontWeight: 800, color: g.pred.winner === home ? FG : MUTED }}>{`${home} ${g.pred.score[home]}`}</span>
        </div>
        <span style={{ fontSize: 16, fontWeight: 700, color: AMBER }}>{`${g.pred.winner} ${Math.round(100 * win)}%`}</span>
      </div>
      <span style={{ fontSize: 12, color: DIM, marginTop: 1 }}>{`${lastName(g.qbs[away])} vs ${lastName(g.qbs[home])}`}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
        <BetLine kind="ML" b={g.best.h2h} />
        <BetLine kind="SPR" b={g.best.spreads} />
        <BetLine kind="TOT" b={g.best.totals} />
      </div>
    </div>
  );
}

const edges = top.filter((t) => t.b?.ev > 0);
function Takeaways() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 474, padding: '14px 18px', borderRadius: 14, background: 'rgba(252,211,77,0.06)', border: '1px solid rgba(252,211,77,0.3)', gap: 7 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: AMBER, letterSpacing: 2 }}>THE HONEST READ</span>
      <span style={{ fontSize: 15, color: FG, lineHeight: 1.35 }}>{edges.length ? `Only ${edges.map((t) => `${t.b.label.replace(' ML', ' moneyline')} (${BOOK[t.b.book]} ${am(t.b.price)})`).join(' and ')} beat the books' margin, and only by 1-3%.` : "No bet beats the books' margin."}</span>
      <span style={{ fontSize: 14, color: MUTED, lineHeight: 1.35 }}>Backtested 2019-2026, our ratings covered 51.5% when they disagreed with the spread by 3+ points (52.4% breaks even). So these predictions lean on the market; game lines are a no-bet unless injury news moves them.</span>
    </div>
  );
}
function Page({ title, gs, n, extra }: { title: string; gs: any[]; n: string; extra?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 1080, height: 1350, background: BG, backgroundImage: 'radial-gradient(ellipse at top, rgba(16,185,129,0.16), transparent 55%)', color: FG, fontFamily: 'Geist', padding: '50px 56px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(180deg,#34d399,#059669)', alignItems: 'center', justifyContent: 'center', fontSize: 25, fontWeight: 800, color: '#022c22' }}>S</div>
          <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: 1 }}>SLIPPR</span>
        </div>
        <span style={{ fontFamily: 'Geist Mono', fontSize: 19, color: DIM }}>{n}</span>
      </div>
      <span style={{ marginTop: 30, fontSize: 20, fontWeight: 600, color: BRIGHT, letterSpacing: 3 }}>{`NFL ${WEEK} · GAME PREDICTIONS`}</span>
      <span style={{ marginTop: 6, fontSize: 52, fontWeight: 800, lineHeight: 1.05 }}>{title}</span>
      <span style={{ marginTop: 10, fontSize: 16, color: MUTED, lineHeight: 1.4 }}>Predicted score and win chance, then the best price across DraftKings, FanDuel and Fliff for the moneyline, spread and total, with its expected return. Green = positive.</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
        {gs.map((g: any) => <Card key={g.game} g={g} />)}
        {extra && <Takeaways />}
      </div>
      <div style={{ display: 'flex', flex: 1 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14, fontSize: 16, color: DIM }}>
        <span>No-vig market price, nudged 7% toward our ratings · research, not betting advice</span>
        <span>slippr.vercel.app</span>
      </div>
    </div>
  );
}
const early = games.filter((g: any) => g.gameday === games[0].gameday && g.gametime <= '13:00');
const late = games.filter((g: any) => !early.includes(g));
const pages = [<Page title="Paris & 1 PM games" gs={early} n="1 / 2" />, <Page title="Late, Sunday & Monday night" gs={late} n="2 / 2" extra />];

async function main() {
  for (const [i, el] of pages.entries()) writeFileSync(`${OUT}/nfl-games-${i + 1}.png`, Buffer.from(await new ImageResponse(el, { width: 1080, height: 1350, fonts }).arrayBuffer()));
  console.log(`wrote ${pages.length} pages to ${OUT}`);
}
main();
