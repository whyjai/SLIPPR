/**
 * MLB signal audit for a completed season (and the one before it):
 *   1. pitcher K% / BB% and team offense vs LHP/RHP: first half vs second half
 *   2. strikeout expectation for starters (BF/start × log5 of pitcher K% and the
 *      opposing lineup's K% vs his hand), first-half inputs vs second-half starts,
 *      against simpler baselines
 *   3. park run factors year to year (sets PARK_TRUST in mlb-research.ts)
 *
 *   npx tsx scripts/research/audit-mlb.mts 2025
 */
import { addLine, addPlay, emptyLine, mlbPeople, mlbPlays, mlbSchedule, woba, type Hand, type Line, type MlbPlay } from '../../lib/research/mlb-data';
import { K_PRIOR_BF, log5 } from '../../lib/research/mlb-research';

const season = Number(process.argv[2] ?? new Date().getUTCFullYear() - 1);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pearson = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < xs.length; i++) {
    a += (xs[i] - mx) * (ys[i] - my);
    b += (xs[i] - mx) ** 2;
    c += (ys[i] - my) ** 2;
  }
  return a / Math.sqrt(b * c);
};
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');

const [plays, people] = await Promise.all([mlbPlays(season), mlbPeople(season)]);
const reg = plays.filter((p) => p.type === 'R');
const dates = [...new Set(reg.map((p) => p.date))].sort();
const mid = dates[Math.floor(dates.length / 2)];
const first = (p: MlbPlay) => p.date < mid;
const throws = (id: number): Hand => people.get(id)?.throws ?? 'R';

// ---------------------------------------------------------------------------
// 1. Stability
{
  const pitcher = [new Map<number, Line>(), new Map<number, Line>()];
  const teamHand = [new Map<string, Line>(), new Map<string, Line>()];
  for (const p of reg) {
    const half = first(p) ? 0 : 1;
    const pl = pitcher[half].get(p.pitcher) ?? emptyLine();
    addPlay(pl, p);
    pitcher[half].set(p.pitcher, pl);
    const k = `${p.bat}|${throws(p.pitcher)}`;
    const tl = teamHand[half].get(k) ?? emptyLine();
    addPlay(tl, p);
    teamHand[half].set(k, tl);
  }
  const both = [...pitcher[0].keys()].filter((id) => (pitcher[0].get(id)?.pa ?? 0) >= 150 && (pitcher[1].get(id)?.pa ?? 0) >= 150);
  const r = (f: (l: Line) => number) => f2(pearson(both.map((id) => f(pitcher[0].get(id)!)), both.map((id) => f(pitcher[1].get(id)!))));
  console.log(`MLB ${season}\n1. First half vs second half (r)`);
  console.log(`   pitchers (${both.length}, 150+ BF each half): K% ${r((l) => l.k / l.pa)} | BB% ${r((l) => l.bb / l.pa)} | wOBA allowed ${r((l) => woba(l)!)}`);
  for (const hand of ['L', 'R'] as Hand[]) {
    const keys = [...teamHand[0].keys()].filter((k) => k.endsWith(hand) && teamHand[1].has(k));
    const tr = (f: (l: Line) => number) => f2(pearson(keys.map((k) => f(teamHand[0].get(k)!)), keys.map((k) => f(teamHand[1].get(k)!))));
    console.log(`   team offense vs ${hand}HP (${keys.length} teams): K% ${tr((l) => l.k / l.pa)} | wOBA ${tr((l) => woba(l)!)}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Strikeout expectation for second-half starts
{
  const pitcher = new Map<number, Line>();
  const starts = new Map<number, { bf: number; n: number }>();
  const teamVs = new Map<string, Line>();
  const league = emptyLine();
  const starter = new Map<string, number>();
  const startLines = new Map<string, Line & { pitcher: number; opp: number }>();
  for (const p of reg) {
    const sk = `${p.gamePk}|${p.fld}`;
    if (!starter.has(sk)) starter.set(sk, p.pitcher);
    const isStarter = starter.get(sk) === p.pitcher;
    if (first(p)) {
      const pl = pitcher.get(p.pitcher) ?? emptyLine();
      addPlay(pl, p);
      pitcher.set(p.pitcher, pl);
      const tk = `${p.bat}|${throws(p.pitcher)}`;
      const tl = teamVs.get(tk) ?? emptyLine();
      addPlay(tl, p);
      teamVs.set(tk, tl);
      addPlay(league, p);
      if (isStarter && p.pa) {
        const s = starts.get(p.pitcher) ?? { bf: 0, n: 0 };
        s.bf++;
        starts.set(p.pitcher, s);
      }
    } else if (isStarter) {
      const row = startLines.get(sk) ?? Object.assign(emptyLine(), { pitcher: p.pitcher, opp: p.bat });
      addPlay(row, p);
      startLines.set(sk, row);
    }
  }
  // starts per pitcher in the first half
  const startCount = new Map<number, number>();
  for (const [k, id] of starter) {
    const date = reg.find((p) => `${p.gamePk}|${p.fld}` === k)?.date;
    if (date && date < mid) startCount.set(id, (startCount.get(id) ?? 0) + 1);
  }
  const lgK = league.k / league.pa;
  const out = { actual: [] as number[], full: [] as number[], pitcherOnly: [] as number[], leagueOnly: [] as number[] };
  for (const s of startLines.values()) {
    const pl = pitcher.get(s.pitcher);
    const n = startCount.get(s.pitcher) ?? 0;
    const st = starts.get(s.pitcher);
    if (!pl || n < 5 || !st) continue;
    const bf = st.bf / n;
    const pk = (pl.k + lgK * K_PRIOR_BF) / (pl.pa + K_PRIOR_BF);
    const opp = teamVs.get(`${s.opp}|${throws(s.pitcher)}`);
    const ok = opp ? opp.k / opp.pa : lgK;
    out.actual.push(s.k);
    out.full.push(bf * log5(pk, ok, lgK));
    out.pitcherOnly.push(bf * pk);
    out.leagueOnly.push(bf * lgK);
  }
  const mae = (p: number[]) => mean(p.map((x, i) => Math.abs(x - out.actual[i])));
  console.log(`\n2. Starter strikeouts, second-half starts (${out.actual.length}), first-half inputs`);
  console.log(`   BF × league K%:              miss ${mae(out.leagueOnly).toFixed(2)} K, r ${f2(pearson(out.leagueOnly, out.actual))}`);
  console.log(`   BF × his K%:                 miss ${mae(out.pitcherOnly).toFixed(2)} K, r ${f2(pearson(out.pitcherOnly, out.actual))}`);
  console.log(`   BF × log5(his K%, opp vs hand): miss ${mae(out.full).toFixed(2)} K, r ${f2(pearson(out.full, out.actual))}`);
}

// ---------------------------------------------------------------------------
// 3. Park run factors year to year
{
  const raw = async (s: number) => {
    const games = (await mlbSchedule(s)).filter((g) => g.type === 'R' && g.final && g.homeScore != null);
    const home = new Map<number, { runs: number; n: number }>();
    const road = new Map<number, { runs: number; n: number }>();
    for (const g of games) {
      const runs = (g.homeScore ?? 0) + (g.awayScore ?? 0);
      const h = home.get(g.home) ?? { runs: 0, n: 0 };
      h.runs += runs;
      h.n++;
      home.set(g.home, h);
      const a = road.get(g.away) ?? { runs: 0, n: 0 };
      a.runs += runs;
      a.n++;
      road.set(g.away, a);
    }
    return new Map([...home].map(([t, h]) => [t, h.runs / h.n / (road.get(t)!.runs / road.get(t)!.n)]));
  };
  const [a, b] = await Promise.all([raw(season - 1), raw(season)]);
  const teams = [...a.keys()].filter((t) => b.has(t));
  const r = pearson(teams.map((t) => a.get(t)!), teams.map((t) => b.get(t)!));
  console.log(`\n3. Park run factor, ${season - 1} vs ${season} (${teams.length} parks): r ${f2(r)} → keep about ${Math.round(100 * Math.max(0, r))}% of a one-season factor`);
}

// keep addLine referenced for tree-shaking clarity in scripts
void addLine;
