/* eslint-disable */
// Renders the NFL Sunday prop board (scripts/research/nfl-board.mts) as 1080x1350 PNGs:
// page 1 the best plays by expected value, pages 2-3 every game's key lines.
//   npx tsx scripts/research/nfl-sunday-graphic.tsx <nfl-board-*.json> <output dir> [week label]
import { readFileSync, writeFileSync } from 'node:fs';
import React from 'react';
import { ImageResponse } from 'next/og';

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
const clean = rows.filter((r) => !r.flagged && r.best);

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

// Page 1: best plays, one per player.
const seen = new Set<string>();
const top = clean.filter((r) => r.best.ev >= 0.01 && !seen.has(r.player) && seen.add(r.player)).slice(0, 11);
const page1 = (
  <Frame kicker={`NFL ${WEEK} · SUNDAY PROP CHEAT SHEET`} title="Best plays on the board" page="1 / 3">
    <div style={{ display: 'flex', marginTop: 22, padding: '0 18px 8px', fontSize: 15, color: DIM, letterSpacing: 1.5 }}>
      <span style={{ width: 300 }}>PLAYER</span>
      <span style={{ width: 290 }}>PICK</span>
      <span style={{ width: 90, justifyContent: 'flex-end', display: 'flex' }}>PROJ</span>
      <span style={{ width: 110, justifyContent: 'flex-end', display: 'flex' }}>CHANCE</span>
      <span style={{ width: 178, justifyContent: 'flex-end', display: 'flex' }}>BEST PRICE · EV</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {top.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '9px 18px', borderRadius: 12, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: 300 }}>
            <span style={{ fontSize: 24, fontWeight: 700 }}>{short(r.player)}</span>
            <span style={{ fontSize: 15, color: DIM }}>{`${r.pos} · ${r.team} vs ${r.opp}${r.injury === 'Questionable' ? ' · QUESTIONABLE' : ''}`}</span>
          </div>
          <span style={{ width: 290, fontSize: 23, fontWeight: 700, color: sideColor(r.side) }}>{`${r.side === 'over' ? 'O' : 'U'} ${r.line} ${r.label}`}</span>
          <span style={{ width: 90, justifyContent: 'flex-end', display: 'flex', fontFamily: 'Geist Mono', fontSize: 20, color: MUTED }}>{String(r.proj)}</span>
          <span style={{ width: 110, justifyContent: 'flex-end', display: 'flex', fontFamily: 'Geist Mono', fontSize: 22, color: FG }}>{pct(r.blend)}</span>
          <span style={{ width: 178, justifyContent: 'flex-end', display: 'flex', fontFamily: 'Geist Mono', fontSize: 18, color: BRIGHT }}>{`${BOOK[r.best.book]} ${am(r.best.price)} · +${(100 * r.best.ev).toFixed(1)}%`}</span>
        </div>
      ))}
    </div>
    <span style={{ marginTop: 14, fontSize: 16, color: MUTED, lineHeight: 1.4 }}>
      Chance: DraftKings + FanDuel no-vig price, moved 30% toward our usage model (game total and spread, player share, efficiency). EV at the best price across DK, FD and Fliff. Small edges: play singles or 2-3 leg slips; check inactives 90 min before kickoff.
    </span>
  </Frame>
);

// Pages 2-3: every game, the QBs' passing line and each team's best skill-position line.
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
const sorted = [...games].filter((g) => clean.some((r) => r.game === g.game)).sort((a, b) => (a.gameday + a.gametime).localeCompare(b.gameday + b.gametime));
const pages = [page1, gamePage(sorted.slice(0, 6), '2 / 3', 'Paris & 1 PM games'), gamePage(sorted.slice(6), '3 / 3', '1 PM, late & night games')];

async function main() {
  for (const [i, el] of pages.entries()) {
    const buf = Buffer.from(await new ImageResponse(el, { width: 1080, height: 1350, fonts }).arrayBuffer());
    writeFileSync(`${OUT}/nfl-sunday-${i + 1}.png`, buf);
  }
  console.log(`wrote ${pages.length} pages to ${OUT}`);
}
main();
