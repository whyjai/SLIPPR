/* eslint-disable */
// Renders the NFL Sunday prop board (scripts/research/nfl-board.mts) as 1080x1350 PNGs:
// pages 1-2 the confirmed plays (lib/research/nfl-tiers.ts) with their receipts, best bets first; pages 3-4 every game's key lines.
// Games that have kicked off are left out.
//   npx tsx scripts/research/nfl-sunday-graphic.tsx <nfl-board-*.json> <output dir> [week label]
import { readFileSync, writeFileSync } from 'node:fs';
import React from 'react';
import { ImageResponse } from 'next/og';
import { nflTiers } from '../../lib/research/nfl-tiers';

const [FILE, OUT = '.', WEEK = 'WEEK 7'] = process.argv.slice(2);
const board = JSON.parse(readFileSync(FILE, 'utf8'));
const FONT = (f: string) => readFileSync(`${process.cwd()}/assets/fonts/${f}`);
const fonts = [500, 600, 700, 800].map((w) => ({ name: 'Geist', data: FONT(`Geist-${w}.ttf`), weight: w as 500, style: 'normal' as const }))
  .concat([500, 600].map((w) => ({ name: 'Geist Mono', data: FONT(`GeistMono-${w}.ttf`), weight: w as 500, style: 'normal' as const })));
const BG = '#070709', FG = '#fafafa', MUTED = '#a1a1aa', DIM = '#71717a', BRIGHT = '#34d399', SKY = '#7dd3fc', AMBER = '#fcd34d';
const BOOK: Record<string, string> = { draftkings: 'DK', fanduel: 'FD', fliff: 'Fliff' };
const pct = (x: number) => `${Math.round(100 * x)}%`;
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const short = (n: string) => n.replace(/ (Jr\.|Sr\.|II|III)$/, '');
const sideColor = (s: string) => (s === 'over' ? BRIGHT : SKY);
const timeLabel = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} ET`;
};

type Row = any;
const rows: Row[] = board.rows;
const started = new Set(rows.filter((r) => Date.parse(r.kickoff) <= Date.now()).map((r) => r.game));
const clean = rows.filter((r) => !r.flagged && r.best && !started.has(r.game));

function Frame({ kicker, title, page, children }: { kicker: string; title: string; page: string; children: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 1080, height: 1350, background: BG, backgroundImage: 'radial-gradient(ellipse at top, rgba(16,185,129,0.16), transparent 55%)', color: FG, fontFamily: 'Geist', padding: '50px 56px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(180deg,#34d399,#059669)', alignItems: 'center', justifyContent: 'center', fontSize: 25, fontWeight: 800, color: '#022c22' }}>S</div>
          <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: 1 }}>SLIPPR</span>
        </div>
        <span style={{ fontFamily: 'Geist Mono', fontSize: 19, color: DIM }}>{page}</span>
      </div>
      <span style={{ marginTop: 30, fontSize: 20, fontWeight: 600, color: BRIGHT, letterSpacing: 3 }}>{kicker}</span>
      <span style={{ marginTop: 6, fontSize: 52, fontWeight: 800, lineHeight: 1.05 }}>{title}</span>
      {children}
      <div style={{ display: 'flex', flex: 1 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14, fontSize: 16, color: DIM }}>
        <span>Research, not betting advice · every pick tracked win or lose</span>
        <span>slippr.vercel.app</span>
      </div>
    </div>
  );
}

// Pages 1-2: confirmed plays, best bets first.
const CHECKS: Array<[string, string]> = [['model', 'MODEL'], ['market', 'MARKET'], ['form', 'FORM'], ['matchup', 'MATCHUP'], ['script', 'SCRIPT'], ['health', 'HEALTH']];
const tiers = nflTiers(rows);
const bestSet = new Set(tiers.best);
const confirmed = [...tiers.best, ...tiers.confirmed.filter((r) => !bestSet.has(r))];
function PlayCard({ r, i }: { r: Row; i: number }) {
  const top = bestSet.has(r);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '10px 18px', borderRadius: 14, background: top ? 'rgba(252,211,77,0.06)' : 'rgba(255,255,255,0.035)', border: `1px solid ${top ? 'rgba(252,211,77,0.45)' : 'rgba(255,255,255,0.08)'}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <span style={{ display: 'flex', width: 34, fontFamily: 'Geist Mono', fontSize: 18, color: DIM }}>{`${i}`}</span>
        <div style={{ display: 'flex', flexDirection: 'column', width: 300 }}>
          <span style={{ fontSize: 24, fontWeight: 700 }}>{short(r.player)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, color: DIM }}>{`${r.pos} · ${r.team} vs ${r.opp}`}</span>
            {top && <span style={{ display: 'flex', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: '#1c1400', background: AMBER, padding: '2px 7px', borderRadius: 5 }}>BEST BET</span>}
          </div>
        </div>
        <span style={{ display: 'flex', width: 330, fontSize: 24, fontWeight: 800, color: sideColor(r.side) }}>{`${r.side === 'over' ? 'OVER' : 'UNDER'} ${r.line} ${r.label}`}</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 1 }}>
          <span style={{ fontFamily: 'Geist Mono', fontSize: 19, color: BRIGHT }}>{`${BOOK[r.best.book]} ${am(r.best.price)}`}</span>
          <span style={{ fontFamily: 'Geist Mono', fontSize: 14, color: MUTED }}>{`${pct(r.blend)} · EV +${(100 * r.best.ev).toFixed(1)}%`}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, marginLeft: 34 }}>
        {CHECKS.map(([k, label]) => {
          const c = r.checks[k];
          const col = c === 'pass' ? BRIGHT : c === 'fail' ? '#f87171' : DIM;
          return <span key={k} style={{ display: 'flex', fontSize: 11, fontWeight: 700, letterSpacing: 1, color: col, padding: '3px 8px', borderRadius: 6, border: `1px solid ${col}55`, background: c === 'pass' ? 'rgba(52,211,153,0.08)' : 'transparent' }}>{`${c === 'pass' ? '+' : c === 'fail' ? 'x' : '-'} ${label}`}</span>;
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 5, marginLeft: 34 }}>
        {r.why.lines.map((l: string, j: number) => <span key={j} style={{ fontSize: 15, color: j === 0 ? FG : MUTED, lineHeight: 1.3 }}>{l}</span>)}
      </div>
    </div>
  );
}
const playsPage = (rs: Row[], from: number, page: string, title: string) => (
  <Frame kicker={`NFL ${WEEK} · CONFIRMED PROP PLAYS`} title={title} page={page}>
    {from === 1 && <span style={{ marginTop: 12, fontSize: 15, color: MUTED, lineHeight: 1.4 }}>Each play has a positive expected return at the best price across DK, FD and Fliff, at least 4 of 6 checks passed and none failed. Gold = best bets: the 3 highest-return plays, one per game, tracked as their own card. What each check means: page 2.</span>}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
      {rs.map((r, i) => <PlayCard key={i} r={r} i={from + i} />)}
    </div>
    {from > 1 && (
      <span style={{ marginTop: 10, fontSize: 14, color: DIM, lineHeight: 1.35 }}>
        Checks: MODEL our usage projection agrees · MARKET the books' no-vig price leans this way · FORM this side hit in 55%+ of his games · MATCHUP the opponent allows 5%+ more (over) or less (under) than average to his position · SCRIPT spread or team total favors this side · HEALTH not on the injury report. Matchup alone is weak evidence: in our 2024-25 backtest it improved projections by under 0.5%.
      </span>
    )}
  </Frame>
);

// Pages 3-4: every game, the QBs' passing line and each team's best skill-position line.
const games = board.games as Array<{ game: string; gameday: string; gametime: string; total: number; spread: number; out: Record<string, string[]> }>;
const keyLines = (game: string) => {
  const g = clean.filter((r) => r.game === game);
  const out: Row[] = [];
  for (const team of game.split(' @ ')) {
    const qb = g.find((r) => r.team === team && r.stat === 'passYds');
    if (qb) out.push(qb);
    const skill = g.filter((r) => r.team === team && r.pos !== 'QB').sort((a, b) => b.best.ev - a.best.ev)[0];
    if (skill) out.push(skill);
  }
  return out;
};
function GameCard({ g }: { g: (typeof games)[number] }) {
  const [away, home] = g.game.split(' @ ');
  const lines = keyLines(g.game);
  const outs = Object.entries(g.out).filter(([, v]) => v.length).map(([t, v]) => `${t}: ${v.map(short).join(', ')}`).join(' · ');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 474, padding: '14px 18px', borderRadius: 14, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 25, fontWeight: 800 }}>{`${away} @ ${home}`}</span>
        <span style={{ fontFamily: 'Geist Mono', fontSize: 14, color: DIM }}>{`${timeLabel(g.gametime)} · O/U ${g.total} · ${home} ${g.spread > 0 ? '-' : '+'}${Math.abs(g.spread)}`}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 9 }}>
        {lines.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 16 }}>
            <span style={{ display: 'flex', width: 172, color: FG, fontWeight: 600 }}>{short(r.player)}</span>
            <span style={{ display: 'flex', width: 196, color: sideColor(r.side), fontWeight: 700 }}>{`${r.side === 'over' ? 'O' : 'U'} ${r.line} ${r.label.replace('Receptions', 'Rec')}`}</span>
            <span style={{ display: 'flex', width: 58, justifyContent: 'flex-end', fontFamily: 'Geist Mono', fontSize: 15, color: MUTED }}>{String(r.proj)}</span>
            <span style={{ display: 'flex', width: 46, justifyContent: 'flex-end', fontFamily: 'Geist Mono', fontSize: 15, color: FG }}>{pct(r.blend)}</span>
          </div>
        ))}
      </div>
      {outs && <span style={{ marginTop: 8, fontSize: 13, color: AMBER, lineHeight: 1.3 }}>{`Out: ${outs}`}</span>}
    </div>
  );
}
const gamePage = (gs: typeof games, page: string, title: string) => (
  <Frame kicker={`NFL ${WEEK} · GAME BY GAME`} title={title} page={page}>
    <span style={{ marginTop: 8, fontSize: 16, color: MUTED }}>Each game: both QBs' passing line and each team's best skill-position line. Line · our projection · chance.</span>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 18 }}>
      {gs.map((g) => <GameCard key={g.game} g={g} />)}
    </div>
  </Frame>
);
const sorted = [...games].filter((g) => !started.has(g.game) && clean.some((r) => r.game === g.game)).sort((a, b) => (a.gameday + a.gametime).localeCompare(b.gameday + b.gametime));
const pages = [
  playsPage(confirmed.slice(0, 5), 1, '1 / 4', 'Best plays, with receipts'),
  playsPage(confirmed.slice(5, 10), 6, '2 / 4', 'More confirmed plays'),
  gamePage(sorted.slice(0, 6), '3 / 4', sorted[0].gametime < '13:00' ? 'Paris & 1 PM games' : '1 PM games'),
  gamePage(sorted.slice(6), '4 / 4', '1 PM, late & night games'),
];

async function main() {
  for (const [i, el] of pages.entries()) {
    const buf = Buffer.from(await new ImageResponse(el, { width: 1080, height: 1350, fonts }).arrayBuffer());
    writeFileSync(`${OUT}/nfl-sunday-${i + 1}.png`, buf);
  }
  console.log(`wrote ${pages.length} pages to ${OUT}`);
}
main();
