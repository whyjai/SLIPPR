/**
 * Render a tracked slip (data/research/slips/*.json) as a 1080x1350 PNG.
 *
 *   npx tsx scripts/research/slip-graphic.tsx <out.png> <slip.json>
 */
/* eslint-disable */
import React from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import { ImageResponse } from 'next/og';

const OUT = process.argv[2];
const slip = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const FONT = (f: string) => readFileSync(`${process.cwd()}/assets/fonts/${f}`);
const fonts = [500, 600, 700, 800].map((w) => ({ name: 'Geist', data: FONT(`Geist-${w}.ttf`), weight: w as 500, style: 'normal' as const }))
  .concat([500, 600].map((w) => ({ name: 'Geist Mono', data: FONT(`GeistMono-${w}.ttf`), weight: w as 500, style: 'normal' as const })));
const BG = '#070709', FG = '#fafafa', MUTED = '#a1a1aa', DIM = '#71717a', BRIGHT = '#34d399', SKY = '#7dd3fc';
const pct = (x: number) => `${Math.round(x * 100)}%`;

function main() {
  const el = (
    <div style={{ display: 'flex', flexDirection: 'column', width: 1080, height: 1350, background: BG, backgroundImage: 'radial-gradient(ellipse at top, rgba(16,185,129,0.18), transparent 55%)', color: FG, fontFamily: 'Geist', padding: '56px 60px 44px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', width: 46, height: 46, borderRadius: 12, background: 'linear-gradient(180deg,#34d399,#059669)', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 800, color: '#022c22' }}>S</div>
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>SLIPPR</span>
        </div>
        <span style={{ fontFamily: 'Geist Mono', fontSize: 20, color: DIM }}>SUN OCT 18 · TRACKED</span>
      </div>
      <span style={{ marginTop: 40, fontSize: 21, fontWeight: 600, color: BRIGHT, letterSpacing: 3 }}>STANDARD LINES · 4-PICK POWER</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, marginTop: 8 }}>
        <span style={{ fontSize: 96, fontWeight: 800, lineHeight: 1 }}>10x</span>
        <span style={{ fontSize: 30, color: MUTED }}>pays · fair ~7.8x</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 40 }}>
        {slip.legs.map((l: any) => (
          <div key={l.player} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 26px', borderRadius: 18, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 34, fontWeight: 700 }}>{l.player}</span>
              <span style={{ fontSize: 21, color: DIM }}>{`${l.sport} · ${l.game} · ${l.team}`}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: SKY }}>{`UNDER ${l.line} ${l.label}`}</span>
              <span style={{ fontFamily: 'Geist Mono', fontSize: 20, color: MUTED }}>{`model ${pct(l.ours)} · sharp ${pct(l.pinnacle)}`}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 34, padding: '24px 28px', borderRadius: 18, background: 'linear-gradient(90deg, rgba(16,185,129,0.16), rgba(16,185,129,0.04))' }}>
        <span style={{ fontSize: 26, fontWeight: 600 }}>All four hit</span>
        <span style={{ fontFamily: 'Geist Mono', fontSize: 30, color: BRIGHT }}>{`~${pct(slip.combined.ours)} · 1 in ${Math.round(1 / slip.combined.ours)}`}</span>
      </div>
      <span style={{ marginTop: 24, fontSize: 19, color: MUTED, lineHeight: 1.4 }}>
        Each leg cleared 55% in both our calibrated model and the sharpest market's no-vig price. Pays 10x on a ~1-in-8 shot: value comes from the payout, not a lock. Lines must match your app.
      </span>
      <div style={{ display: 'flex', flex: 1 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16, fontSize: 17, color: DIM }}>
        <span>Research, not betting advice · tracked publicly win or lose</span>
        <span>slippr.vercel.app</span>
      </div>
    </div>
  );
  return new ImageResponse(el, { width: 1080, height: 1350, fonts }).arrayBuffer().then((b) => writeFileSync(OUT, Buffer.from(b)));
}
main();
