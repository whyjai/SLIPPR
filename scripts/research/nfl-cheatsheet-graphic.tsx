/* eslint-disable */
// Renders this week's NFL prop cheat sheet as three 1080x1350 PNGs in the SLIPPR style.
//   npx tsx scripts/research/nfl-cheatsheet-graphic.tsx <output dir>
import { readFileSync, writeFileSync } from 'node:fs';
import React from 'react';
import { ImageResponse } from 'next/og';
import { getNflPropSheet } from '../../lib/research/nfl-props';
import { playerWeeks } from '../../lib/research/nflverse';

const OUT = process.argv[2] ?? '.';
const FONT = (f: string) => readFileSync(`${process.cwd()}/assets/fonts/${f}`);
const fonts = [
  { name: 'Geist', data: FONT('Geist-500.ttf'), weight: 500 as const, style: 'normal' as const },
  { name: 'Geist', data: FONT('Geist-600.ttf'), weight: 600 as const, style: 'normal' as const },
  { name: 'Geist', data: FONT('Geist-700.ttf'), weight: 700 as const, style: 'normal' as const },
  { name: 'Geist', data: FONT('Geist-800.ttf'), weight: 800 as const, style: 'normal' as const },
  { name: 'Geist Mono', data: FONT('GeistMono-500.ttf'), weight: 500 as const, style: 'normal' as const },
  { name: 'Geist Mono', data: FONT('GeistMono-600.ttf'), weight: 600 as const, style: 'normal' as const },
];

const BG = '#070709', FG = '#fafafa', MUTED = '#a1a1aa', DIM = '#71717a', BRIGHT = '#34d399', ROSE = '#fda4af', SKY = '#7dd3fc', AMBER = '#fcd34d';

async function main() {
// NFL seasons run into January-February of the next year.
const now = new Date();
const sheet = await getNflPropSheet(now.getUTCMonth() < 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());
const sides = sheet.games.flatMap((g) => g.sides.map((s) => ({ g, ...s })));
const n = 32;
const ord = (k: number) => { const s = ['th', 'st', 'nd', 'rd'], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); };
const place = (rank: number) => (rank <= 16 ? (rank === 1 ? 'most' : `${ord(rank)}-most`) : rank === n ? 'fewest' : `${ord(n - rank + 1)}-fewest`);

function Frame({ title, kicker, children, page }: { title: string; kicker: string; children: any; page: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 1080, height: 1350, background: BG, backgroundImage: 'radial-gradient(ellipse at top, rgba(16,185,129,0.16), transparent 55%)', color: FG, fontFamily: 'Geist', padding: '54px 60px 44px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', width: 46, height: 46, borderRadius: 12, background: 'linear-gradient(180deg,#34d399,#059669)', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 800, color: '#022c22' }}>S</div>
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>SLIPPR</span>
        </div>
        <span style={{ fontFamily: 'Geist Mono', fontSize: 20, color: DIM }}>{page}</span>
      </div>
      <span style={{ marginTop: 34, fontSize: 20, fontWeight: 600, color: BRIGHT, letterSpacing: 3 }}>{kicker}</span>
      <span style={{ marginTop: 8, fontSize: 58, fontWeight: 800, lineHeight: 1.05 }}>{title}</span>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginTop: 28 }}>{children}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16, fontSize: 17, color: DIM }}>
        <span>Box scores via nflverse · injuries via ESPN, Sun Oct 18 · research, not betting advice</span>
        <span>slippr.vercel.app</span>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 26, fontWeight: 700 }}>{title}</span>
        {note && <span style={{ fontSize: 17, color: DIM }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ left, right, sub, color = FG }: { left: string; right: string; sub?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', marginBottom: 6 }}>
      <span style={{ fontSize: 20, fontWeight: 600, color }}>{left}</span>
      <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'Geist Mono', fontSize: 20, color: FG }}>{right}</span>
        {sub && <span style={{ fontFamily: 'Geist Mono', fontSize: 15, color: DIM }}>{sub}</span>}
      </span>
    </div>
  );
}

const Two = ({ a, b }: { a: any; b: any }) => (
  <div style={{ display: 'flex', gap: 22 }}>
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>{a}</div>
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>{b}</div>
  </div>
);

// ---------------------------------------------------------------- page 1
const sortBy = (f: (s: (typeof sides)[number]) => number) => [...sides].sort((x, y) => f(x) - f(y));
const softRun = sortBy((s) => s.defense.run.rbRushYds.rank).slice(0, 5);
const toughRun = sortBy((s) => -s.defense.run.rbRushYds.rank).slice(0, 5);
const softPass = sortBy((s) => s.defense.pass.qbPassYds.rank).slice(0, 5);
const wr = sortBy((s) => s.defense.pass.wrRecYds.rank).slice(0, 4);
const te = sortBy((s) => s.defense.pass.teRecYds.rank).slice(0, 4);
const passFunnel = sides.filter((s) => s.defense.funnel === 'pass');
const runFunnel = sides.filter((s) => s.defense.funnel === 'run');

const page1 = (
  <Frame kicker={`NFL WEEK ${sheet.week} · PROP CHEAT SHEET`} title="Run & pass defense matchups" page="1 / 3">
    <Section title="Run defense vs RBs" note="RB rush yds allowed per game · yds per run">
      <Two
        a={<div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 18, color: BRIGHT, marginBottom: 8, fontWeight: 600 }}>SOFTEST</span>
          {softRun.map((s) => <Row key={s.offense} left={`${s.offense} RBs vs ${s.defense.team}`} right={s.defense.run.rbRushYds.value.toFixed(0)} sub={`${s.defense.run.yardsPerRush.value.toFixed(1)} ypc`} color={BRIGHT} />)}
        </div>}
        b={<div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 18, color: ROSE, marginBottom: 8, fontWeight: 600 }}>TOUGHEST</span>
          {toughRun.map((s) => <Row key={s.offense} left={`${s.offense} RBs vs ${s.defense.team}`} right={s.defense.run.rbRushYds.value.toFixed(0)} sub={`${s.defense.run.yardsPerRush.value.toFixed(1)} ypc`} color={ROSE} />)}
        </div>}
      />
    </Section>
    <Section title="Pass defense" note="per game allowed">
      <Two
        a={<div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 18, color: BRIGHT, marginBottom: 8, fontWeight: 600 }}>QB PASS YDS ALLOWED</span>
          {softPass.map((s) => <Row key={s.offense} left={`${s.offense} QB vs ${s.defense.team}`} right={s.defense.pass.qbPassYds.value.toFixed(0)} sub={place(s.defense.pass.qbPassYds.rank)} />)}
        </div>}
        b={<div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 18, color: BRIGHT, marginBottom: 8, fontWeight: 600 }}>WR / TE YDS ALLOWED</span>
          {wr.map((s) => <Row key={`wr${s.offense}`} left={`${s.offense} WRs vs ${s.defense.team}`} right={s.defense.pass.wrRecYds.value.toFixed(0)} sub="WR" />)}
          {te.slice(0, 2).map((s) => <Row key={`te${s.offense}`} left={`${s.offense} TE vs ${s.defense.team}`} right={s.defense.pass.teRecYds.value.toFixed(0)} sub="TE" />)}
        </div>}
      />
    </Section>
    <Section title="Funnels" note="share of plays opponents pass against them">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {passFunnel.map((s) => <span key={`p${s.offense}`} style={{ fontSize: 18, padding: '6px 12px', borderRadius: 999, background: 'rgba(125,211,252,0.12)', color: SKY }}>{`PASS · ${s.offense} vs ${s.defense.team} ${(100 * s.defense.passRateFaced.value).toFixed(0)}%`}</span>)}
        {runFunnel.map((s) => <span key={`r${s.offense}`} style={{ fontSize: 18, padding: '6px 12px', borderRadius: 999, background: 'rgba(253,211,77,0.10)', color: AMBER }}>{`RUN · ${s.offense} vs ${s.defense.team} ${(100 * s.defense.passRateFaced.value).toFixed(0)}%`}</span>)}
      </div>
    </Section>
    <span style={{ fontSize: 17, color: MUTED, lineHeight: 1.35 }}>
      Context, not a projection: in 2024-25 tests run D didn't predict RB rushing and pass D barely moved QB/WR/TE. What held up: RBs catch more vs pass funnels.
    </span>
  </Frame>
);

// ---------------------------------------------------------------- page 2
const outs = sides.flatMap((s) => (s.out ?? []).map((o) => ({ ...o, team: s.offense })));
const keyOuts = outs.filter((o) => ['QB', 'RB', 'WR', 'TE'].includes(o.pos));
const questionable = sides.flatMap((s) => s.players.filter((p) => p.injury && p.injury.status === 'Questionable').map((p) => ({ name: p.name, pos: p.pos, team: s.offense })));
const traded = sides.flatMap((s) => s.players.filter((p) => p.formerTeam).map((p) => ({ name: p.name, team: s.offense, from: p.formerTeam! })));
const noQb = sides.filter((s) => !s.players.some((p) => p.pos === 'QB')).map((s) => s.offense);
// QB situation: show a team when its main QB this season (most attempts) is out.
const qbRows = (await playerWeeks(sheet.season)).filter((w) => w.seasonType === 'REG' && w.position === 'QB' && Number(w.attempts) > 0);
const espnTeams = (await (await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams')).json()).sports[0].leagues[0].teams.map((t: { team: { id: string; abbreviation: string } }) => t.team);
const newQb = (await Promise.all(sides.map(async (s) => {
  const team = qbRows.filter((w) => w.team === s.offense);
  const total = new Map<string, number>();
  for (const w of team) total.set(w.name, (total.get(w.name) ?? 0) + Number(w.attempts));
  const primary = [...total].sort((x, y) => y[1] - x[1])[0]?.[0];
  const outQbs = (s.out ?? []).filter((o) => o.pos === 'QB').map((o) => o.name);
  if (!primary || !outQbs.includes(primary)) return [] as Array<{ team: string; out: string; qb: string | null; note: string }>;
  // Who starts: ESPN's depth chart, first QB who isn't ruled out.
  const espnAbbr = ({ WAS: 'WSH', LA: 'LAR' } as Record<string, string>)[s.offense] ?? s.offense;
  const espnTeam = espnTeams.find((t: { abbreviation: string }) => t.abbreviation === espnAbbr);
  const dc = espnTeam ? await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnTeam.id}/depthcharts`)).json() : null;
  const depthQbs: string[] = (dc?.depthchart ?? []).flatMap((c: { positions?: Record<string, { athletes?: Array<{ displayName: string }> }> }) => c.positions?.qb?.athletes?.map((a) => a.displayName) ?? []);
  const replacement = depthQbs.find((nm) => !outQbs.includes(nm)) ?? s.players.find((p) => p.pos === 'QB')?.name ?? null;
  const starts = replacement ? team.filter((w) => w.name === replacement && Number(w.attempts) >= 15).length : 0;
  return [{ team: s.offense, out: primary, qb: replacement, note: replacement ? (starts ? `${replacement}: start #${starts + 1}` : `${replacement}: first start`) : 'backup, no data' }];
}))).flat();

const page2 = (
  <Frame kicker={`NFL WEEK ${sheet.week} · PROP CHEAT SHEET`} title="Injury & role watch" page="2 / 3">
    <Section title="Quarterback changes">
      {newQb.map((q) => <Row key={q.team} left={`${q.team}: ${q.out} out`} right={q.note} color={AMBER} />)}
    </Section>
    <Section title="Ruled out" note="Out / IR per ESPN · their teammates' roles can grow beyond the averages">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {keyOuts.filter((o) => o.pos !== 'QB').map((o) => <span key={o.name} style={{ fontSize: 18, padding: '6px 11px', borderRadius: 9, background: 'rgba(253,164,175,0.10)', color: ROSE }}>{`${o.name} · ${o.team} ${o.pos}`}</span>)}
      </div>
    </Section>
    <Section title="Questionable">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {questionable.map((o) => <span key={o.name} style={{ fontSize: 18, padding: '6px 11px', borderRadius: 9, background: 'rgba(253,211,77,0.10)', color: AMBER }}>{`${o.name} · ${o.team} ${o.pos}`}</span>)}
      </div>
    </Section>
    {traded.length > 0 && (
      <Section title="New team this week">
        {traded.map((t) => <Row key={t.name} left={`${t.name}`} right={`${t.from} → ${t.team}`} sub="debut" color={SKY} />)}
      </Section>
    )}
    <span style={{ fontSize: 18, color: MUTED, lineHeight: 1.35 }}>
      ESPN injury report, Sunday morning. Check inactives 90 minutes before kickoff.
    </span>
  </Frame>
);

// ---------------------------------------------------------------- page 3
type Line = { name: string; team: string; opp: string; median: number; low: number; high: number; line: number; chance: number; inj: string | null };
const lines = (stat: string, pos: string[], k: number): Line[] =>
  sides
    .flatMap((s) => s.players.filter((p) => pos.includes(p.pos)).map((p) => {
      const pr = p.props.find((x) => x.stat === stat);
      if (!pr) return null;
      const mid = pr.lines.reduce((a, b) => (Math.abs(b.chance - 50) < Math.abs(a.chance - 50) ? b : a), pr.lines[0]);
      return { name: p.name, team: s.offense, opp: s.defense.team, median: pr.median, low: pr.low, high: pr.high, line: mid.line, chance: mid.chance, inj: p.injury?.status ?? null };
    }))
    .filter((x): x is Line => !!x)
    .sort((a, b) => b.median - a.median)
    .slice(0, k);

function LineTable({ title, rows }: { title: string; rows: Line[] }) {
  return (
    <Section title={title}>
      {rows.map((r) => (
        <div key={r.name} style={{ display: 'flex', alignItems: 'baseline', padding: '6px 14px', borderRadius: 9, background: 'rgba(255,255,255,0.03)', marginBottom: 5 }}>
          <span style={{ width: 330, fontSize: 20, fontWeight: 600, color: FG }}>{`${r.name}${r.inj ? ' (Q)' : ''}`}</span>
          <span style={{ width: 125, fontSize: 17, color: DIM }}>{`${r.team} v ${r.opp}`}</span>
          <span style={{ width: 95, fontFamily: 'Geist Mono', fontSize: 21, color: BRIGHT }}>{r.median.toFixed(0)}</span>
          <span style={{ width: 150, fontFamily: 'Geist Mono', fontSize: 17, color: DIM }}>{`${r.low.toFixed(0)}–${r.high.toFixed(0)}`}</span>
          <span style={{ fontFamily: 'Geist Mono', fontSize: 17, color: MUTED }}>{`o${r.line} · ${r.chance}%`}</span>
        </div>
      ))}
    </Section>
  );
}

const page3 = (
  <Frame kicker={`NFL WEEK ${sheet.week} · PROP CHEAT SHEET`} title="Typical game, top players" page="3 / 3">
    <div style={{ display: 'flex', fontSize: 16, color: DIM, marginTop: -8, marginBottom: 8, paddingLeft: 14 }}>
      <span style={{ width: 455 }}>player · matchup</span><span style={{ width: 95, color: BRIGHT }}>median</span><span style={{ width: 150 }}>middle 50%</span><span>line · chance over</span>
    </div>
    <LineTable title="QB passing yards" rows={lines('passYds', ['QB'], 5)} />
    <LineTable title="RB rushing yards" rows={lines('rushYds', ['RB'], 5)} />
    <LineTable title="WR / TE receiving yards" rows={lines('recYds', ['WR', 'TE'], 7)} />
    <span style={{ fontSize: 18, color: MUTED, lineHeight: 1.4 }}>
      Median = typical game (season average, 25% weight on the last 3). Chance over is calibrated on 2025 within ~3 points. Medians sit below averages: lines set at a player's average go under more often than over.
    </span>
  </Frame>
);

for (const [i, el] of [page1, page2, page3].entries()) {
  const res = new ImageResponse(el, { width: 1080, height: 1350, fonts });
  writeFileSync(`${OUT}/week${sheet.week}-cheatsheet-${i + 1}.png`, Buffer.from(await res.arrayBuffer()));
  console.log('wrote', `week${sheet.week}-cheatsheet-${i + 1}.png`);
}
console.log({ noQb, newQb, traded, q: questionable.length, outs: keyOuts.length });
}
main();
