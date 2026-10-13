/**
 * MLB research: team offense and pitching (with platoon splits), hitter and
 * pitcher trends with game logs, park factors, and the next slate's probable
 * starters with a strikeout expectation.
 *
 * What the numbers are worth is measured by scripts/research/audit-mlb.mts and
 * quoted where they're shown.
 */
import { cached } from './csv';
import {
  addLine,
  addPlay,
  emptyLine,
  fip,
  latestMlbSeason,
  mlbPeople,
  mlbPlays,
  mlbSchedule,
  mlbTeams,
  nextMlbSlate,
  rate,
  slash,
  woba,
  type Hand,
  type Line,
  type MlbPlay,
} from './mlb-data';
import { rank, type NflTeamTendencies, type TendencyMetric } from './nfl-teams';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 1000);
const pct = (x: number, d: number) => (d ? r1((100 * x) / d) : null);
/** Innings in baseball notation: 186⅓ → 186.1. */
const ipOf = (outs: number) => Math.floor(outs / 3) + (outs % 3) / 10;

// ---------------------------------------------------------------------------
// One pass over a season's plays
// ---------------------------------------------------------------------------

type Split = { all: Line; vsL: Line; vsR: Line };
const split = (): Split => ({ all: emptyLine(), vsL: emptyLine(), vsR: emptyLine() });

export type GameLine = Line & { gamePk: number; date: string; team: number; opp: number; started: boolean; oppHand: Hand | null };

type Agg = {
  season: number;
  teamBat: Map<number, Split>; // keyed by batting team, split by pitcher hand
  teamPitch: Map<number, { all: Line; starters: Line; bullpen: Line; starts: number }>;
  batters: Map<number, { split: Split; games: GameLine[] }>; // split by pitcher hand
  pitchers: Map<number, { split: Split; games: GameLine[] }>; // split by batter side faced
  games: Map<number, number>; // team → regular-season games
};

function aggregate(season: number, plays: MlbPlay[], hands: Map<number, { bats: string; throws: Hand }>): Agg {
  const agg: Agg = { season, teamBat: new Map(), teamPitch: new Map(), batters: new Map(), pitchers: new Map(), games: new Map() };
  const starter = new Map<string, number>(); // `${gamePk}|${fieldingTeam}` → first pitcher
  const gameRow = new Map<string, GameLine>();
  const seenGame = new Set<string>();

  for (const p of plays) {
    if (p.type !== 'R') continue;
    for (const t of [p.bat, p.fld]) {
      const k = `${p.gamePk}|${t}`;
      if (!seenGame.has(k)) {
        seenGame.add(k);
        agg.games.set(t, (agg.games.get(t) ?? 0) + 1);
      }
    }
    const sKey = `${p.gamePk}|${p.fld}`;
    if (!starter.has(sKey)) starter.set(sKey, p.pitcher);
    const isStarter = starter.get(sKey) === p.pitcher;
    const pitchHand = hands.get(p.pitcher)?.throws ?? 'R';
    const bats = hands.get(p.batter)?.bats ?? 'R';
    // A switch hitter bats from the side opposite the pitcher.
    const batSide: Hand = bats === 'S' ? (pitchHand === 'L' ? 'R' : 'L') : (bats as Hand);

    const tb = agg.teamBat.get(p.bat) ?? split();
    addPlay(tb.all, p);
    addPlay(pitchHand === 'L' ? tb.vsL : tb.vsR, p);
    agg.teamBat.set(p.bat, tb);

    const tp = agg.teamPitch.get(p.fld) ?? { all: emptyLine(), starters: emptyLine(), bullpen: emptyLine(), starts: 0 };
    addPlay(tp.all, p);
    addPlay(isStarter ? tp.starters : tp.bullpen, p);
    agg.teamPitch.set(p.fld, tp);

    const b = agg.batters.get(p.batter) ?? { split: split(), games: [] };
    addPlay(b.split.all, p);
    addPlay(pitchHand === 'L' ? b.split.vsL : b.split.vsR, p);
    agg.batters.set(p.batter, b);
    const bg = `b|${p.gamePk}|${p.batter}`;
    if (!gameRow.has(bg)) {
      const row: GameLine = { ...emptyLine(), gamePk: p.gamePk, date: p.date, team: p.bat, opp: p.fld, started: false, oppHand: hands.get(starter.get(sKey)!)?.throws ?? null };
      gameRow.set(bg, row);
      b.games.push(row);
    }
    addPlay(gameRow.get(bg)!, p);

    const pi = agg.pitchers.get(p.pitcher) ?? { split: split(), games: [] };
    addPlay(pi.split.all, p);
    addPlay(batSide === 'L' ? pi.split.vsL : pi.split.vsR, p);
    agg.pitchers.set(p.pitcher, pi);
    const pg = `p|${p.gamePk}|${p.pitcher}`;
    if (!gameRow.has(pg)) {
      const row: GameLine = { ...emptyLine(), gamePk: p.gamePk, date: p.date, team: p.fld, opp: p.bat, started: isStarter, oppHand: null };
      gameRow.set(pg, row);
      pi.games.push(row);
    }
    addPlay(gameRow.get(pg)!, p);
  }
  for (const [team, tp] of agg.teamPitch) tp.starts = agg.games.get(team) ?? 0;
  return agg;
}

export function mlbAggregate(season: number): Promise<Agg> {
  return cached(`mlb-agg-${season}`, async () => {
    const [plays, people] = await Promise.all([mlbPlays(season), mlbPeople(season)]);
    return aggregate(season, plays, people);
  });
}

// ---------------------------------------------------------------------------
// Team tendencies (same shape as the NFL/NBA panels)
// ---------------------------------------------------------------------------

export const MLB_OFFENSE_METRICS: TendencyMetric[] = [
  { key: 'runs', label: 'Runs / game', unit: '', highIsFirst: true, hint: 'Runs scored per game. Not park-adjusted: see Park factors (Coors inflates Colorado).' },
  { key: 'woba', label: 'wOBA', unit: 'avg', highIsFirst: true, hint: 'Weighted on-base average: every way of reaching base, weighted by run value.' },
  { key: 'wobaVsL', label: 'wOBA vs LHP', unit: 'avg', highIsFirst: true, hint: 'wOBA against left-handed pitchers.' },
  { key: 'wobaVsR', label: 'wOBA vs RHP', unit: 'avg', highIsFirst: true, hint: 'wOBA against right-handed pitchers.' },
  { key: 'kPct', label: 'K%', unit: '%', highIsFirst: true, hint: 'Strikeouts per plate appearance. #1 = strikes out the most.' },
  { key: 'kPctVsL', label: 'K% vs LHP', unit: '%', highIsFirst: true, hint: 'Strikeout rate against left-handed pitchers.' },
  { key: 'kPctVsR', label: 'K% vs RHP', unit: '%', highIsFirst: true, hint: 'Strikeout rate against right-handed pitchers.' },
  { key: 'bbPct', label: 'BB%', unit: '%', highIsFirst: true, hint: 'Walks per plate appearance.' },
  { key: 'iso', label: 'ISO (power)', unit: 'avg', highIsFirst: true, hint: 'Isolated power: slugging minus batting average.' },
  { key: 'hrPct', label: 'HR%', unit: '%', highIsFirst: true, hint: 'Home runs per plate appearance.' },
];

export const MLB_PITCHING_METRICS: TendencyMetric[] = [
  { key: 'runsAllowed', label: 'Runs allowed / game', unit: '', highIsFirst: true, hint: 'Runs allowed per game. #1 = allows the most. Not park-adjusted (Coors inflates Colorado).' },
  { key: 'wobaAllowed', label: 'wOBA allowed', unit: 'avg', highIsFirst: true, hint: 'Opponent wOBA. #1 = allows the most. Not park-adjusted.' },
  { key: 'kPct', label: 'K%', unit: '%', highIsFirst: false, hint: 'Strikeouts per batter faced. #1 = strikes out the fewest.' },
  { key: 'bbPct', label: 'BB%', unit: '%', highIsFirst: true, hint: 'Walks per batter faced. #1 = walks the most.' },
  { key: 'hrPct', label: 'HR%', unit: '%', highIsFirst: true, hint: 'Home runs per batter faced. #1 = allows the most.' },
  { key: 'starterFip', label: 'Rotation FIP', unit: '', highIsFirst: true, hint: 'Starters’ fielding-independent pitching (K, BB, HBP, HR per inning). #1 = worst.' },
  { key: 'bullpenFip', label: 'Bullpen FIP', unit: '', highIsFirst: true, hint: 'Relievers’ FIP. #1 = worst.' },
  { key: 'starterIp', label: 'Starter innings', unit: '', highIsFirst: false, hint: 'Innings per start. #1 = shortest starts (most bullpen work).' },
];

export type MlbTeamTendencies = NflTeamTendencies & { sport: 'mlb'; seasonLabel: string; gamesPlayed: number };

export function teamValues(agg: Agg, team: number) {
  const b = agg.teamBat.get(team)!;
  const p = agg.teamPitch.get(team)!;
  const g = agg.games.get(team) || 1;
  return {
    offense: {
      runs: r1(b.all.runs / g),
      woba: r3(woba(b.all)),
      wobaVsL: r3(woba(b.vsL)),
      wobaVsR: r3(woba(b.vsR)),
      kPct: pct(b.all.k, b.all.pa),
      kPctVsL: pct(b.vsL.k, b.vsL.pa),
      kPctVsR: pct(b.vsR.k, b.vsR.pa),
      bbPct: pct(b.all.bb, b.all.pa),
      iso: r3(slash(b.all).iso),
      hrPct: pct(b.all.hr, b.all.pa),
    } as Record<string, number | null>,
    defense: {
      runsAllowed: r1(p.all.runs / g),
      wobaAllowed: r3(woba(p.all)),
      kPct: pct(p.all.k, p.all.pa),
      bbPct: pct(p.all.bb, p.all.pa),
      hrPct: pct(p.all.hr, p.all.pa),
      starterFip: fip(p.starters) == null ? null : Math.round(fip(p.starters)! * 100) / 100,
      bullpenFip: fip(p.bullpen) == null ? null : Math.round(fip(p.bullpen)! * 100) / 100,
      starterIp: r1(p.starters.outs / 3 / (p.starts || 1)),
    } as Record<string, number | null>,
  };
}

export async function getMlbTeamTendencies(season: number): Promise<MlbTeamTendencies> {
  const [agg, teams] = await Promise.all([mlbAggregate(season), mlbTeams(season)]);
  const ids = [...agg.teamBat.keys()].filter((id) => teams.has(id));
  const rows = ids.map((id) => ({ id, team: teams.get(id)!.abbr, ...teamValues(agg, id) }));
  const off = rank(rows.map((r) => ({ team: r.team, values: r.offense })), MLB_OFFENSE_METRICS);
  const def = rank(rows.map((r) => ({ team: r.team, values: r.defense })), MLB_PITCHING_METRICS);
  const gamesPlayed = Math.min(...ids.map((id) => agg.games.get(id) ?? 0));
  return {
    sport: 'mlb',
    season,
    seasonLabel: String(season),
    gamesPlayed,
    throughWeek: gamesPlayed,
    chartedThroughWeek: gamesPlayed,
    chartedPartialGames: 0,
    hasCharting: false,
    coverageSeason: null,
    offenseMetrics: MLB_OFFENSE_METRICS,
    defenseMetrics: MLB_PITCHING_METRICS,
    teams: rows
      .map((r) => ({ team: r.team, name: teams.get(r.id)!.name, games: agg.games.get(r.id) ?? 0, offense: off.cells[r.team], defense: def.cells[r.team] }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    leagueAvg: { offense: off.avg, defense: def.avg },
  };
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export type HitterLine = {
  pa: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  woba: number | null;
  hr: number;
  kPct: number | null;
  bbPct: number | null;
};
const hitterLine = (l: Line): HitterLine => {
  const s = slash(l);
  return { pa: l.pa, avg: r3(s.avg), obp: r3(s.obp), slg: r3(s.slg), ops: r3(s.ops), woba: r3(woba(l)), hr: l.hr, kPct: pct(l.k, l.pa), bbPct: pct(l.bb, l.pa) };
};

export type PitcherLine = {
  bf: number;
  ip: number;
  kPct: number | null;
  bbPct: number | null;
  kbb: number | null;
  hr9: number | null;
  fip: number | null;
  wobaAllowed: number | null;
};
const pitcherLine = (l: Line): PitcherLine => {
  const ip = l.outs / 3;
  const f = fip(l);
  return {
    bf: l.pa,
    ip: ipOf(l.outs),
    kPct: pct(l.k, l.pa),
    bbPct: pct(l.bb, l.pa),
    kbb: l.pa ? r1((100 * (l.k - l.bb)) / l.pa) : null,
    hr9: ip ? Math.round(((9 * l.hr) / ip) * 100) / 100 : null,
    fip: f == null ? null : Math.round(f * 100) / 100,
    wobaAllowed: r3(woba(l)),
  };
};

/** Platoon line: enough to compare sides without shipping full lines. */
export type HandLine = { pa: number; ops: number | null; woba: number | null; kPct: number | null };
const handLine = (l: Line): HandLine => ({ pa: l.pa, ops: r3(slash(l).ops), woba: r3(woba(l)), kPct: pct(l.k, l.pa) });

export type HitterLog = { date: string; opp: string; oppHand: Hand | null; pa: number; h: number; tb: number; hr: number; rbi: number; bb: number; k: number };
export type PitcherLog = { date: string; opp: string; started: boolean; ip: number; bf: number; k: number; bb: number; h: number; hr: number; r: number };

export type MlbHitter = {
  id: number;
  name: string;
  pos: string;
  bats: string;
  team: string;
  games: number;
  season: HitterLine;
  vsL: HandLine;
  vsR: HandLine;
  last15: HitterLine;
  log: HitterLog[]; // newest first, 10
};

export type MlbPitcher = {
  id: number;
  name: string;
  throws: Hand;
  team: string;
  starts: number;
  appearances: number;
  season: PitcherLine;
  vsL: HandLine; // vs left-handed batters
  vsR: HandLine;
  ipPerStart: number | null;
  bfPerStart: number | null;
  log: PitcherLog[]; // newest first, 10
};

export type MlbPlayerTrends = { sport: 'mlb'; season: number; seasonLabel: string; generatedAt: string; hitters: MlbHitter[]; pitchers: MlbPitcher[] };

export async function getMlbPlayerTrends(season: number): Promise<MlbPlayerTrends> {
  const [agg, teams, people] = await Promise.all([mlbAggregate(season), mlbTeams(season), mlbPeople(season)]);
  const abbr = (id: number) => teams.get(id)?.abbr ?? '';
  const sum = (rows: Line[]) => {
    const l = emptyLine();
    for (const r of rows) addLine(l, r);
    return l;
  };

  const hitters: MlbHitter[] = [];
  for (const [id, b] of agg.batters) {
    const person = people.get(id);
    if (!person || person.pos === 'P' || b.split.all.pa < 150) continue;
    const games = [...b.games].sort((x, y) => x.date.localeCompare(y.date));
    hitters.push({
      id,
      name: person.name,
      pos: person.pos,
      bats: person.bats,
      team: abbr(games[games.length - 1].team),
      games: games.length,
      season: hitterLine(b.split.all),
      vsL: handLine(b.split.vsL),
      vsR: handLine(b.split.vsR),
      last15: hitterLine(sum(games.slice(-15))),
      log: games
        .slice(-10)
        .reverse()
        .map((g) => ({ date: g.date, opp: abbr(g.opp), oppHand: g.oppHand, pa: g.pa, h: g.h, tb: g.tb, hr: g.hr, rbi: g.rbi, bb: g.bb, k: g.k })),
    });
  }
  hitters.sort((a, b) => (b.season.woba ?? 0) * b.season.pa - (a.season.woba ?? 0) * a.season.pa);

  const pitchers: MlbPitcher[] = [];
  for (const [id, p] of agg.pitchers) {
    const person = people.get(id);
    if (!person || p.split.all.pa < 120) continue;
    const games = [...p.games].sort((x, y) => x.date.localeCompare(y.date));
    const starts = games.filter((g) => g.started);
    pitchers.push({
      id,
      name: person.name,
      throws: person.throws,
      team: abbr(games[games.length - 1].team),
      starts: starts.length,
      appearances: games.length,
      season: pitcherLine(p.split.all),
      vsL: handLine(p.split.vsL),
      vsR: handLine(p.split.vsR),
      ipPerStart: starts.length ? r1(starts.reduce((a, g) => a + g.outs, 0) / 3 / starts.length) : null,
      bfPerStart: starts.length ? r1(starts.reduce((a, g) => a + g.pa, 0) / starts.length) : null,
      log: games
        .slice(-10)
        .reverse()
        .map((g) => ({ date: g.date, opp: abbr(g.opp), started: g.started, ip: ipOf(g.outs), bf: g.pa, k: g.k, bb: g.bb, h: g.h, hr: g.hr, r: g.runs })),
    });
  }
  pitchers.sort((a, b) => b.starts - a.starts || b.season.bf - a.season.bf);
  return { sport: 'mlb', season, seasonLabel: String(season), generatedAt: new Date().toISOString(), hitters, pitchers };
}

// ---------------------------------------------------------------------------
// Park factors and the next slate
// ---------------------------------------------------------------------------

/**
 * A single season's park run factor barely carries to the next (audit-mlb.mts:
 * year-to-year r 0.22-0.27), so a three-season average is worth about half
 * (Spearman-Brown: 3r / (1 + 2r) ≈ 0.47-0.53). Each season is pulled halfway to
 * neutral, then averaged.
 */
export const PARK_TRUST = 0.5;

export type ParkFactor = { venueId: number; venue: string; team: string; factor: number; seasons: number };

/** Runs per game at a park (both teams) vs. its home team's road games, last three seasons. */
export function parkFactors(season: number): Promise<ParkFactor[]> {
  return cached(`mlb-parks-${season}`, async () => {
    const teams = await mlbTeams(season);
    const per = new Map<number, { venue: string; team: number; factors: number[] }>();
    for (const s of [season - 2, season - 1, season]) {
      const games = (await mlbSchedule(s).catch(() => [])).filter((g) => g.type === 'R' && g.final && g.homeScore != null);
      if (!games.length) continue;
      const home = new Map<number, { runs: number; n: number; venue: Map<number, { name: string; n: number }> }>();
      const road = new Map<number, { runs: number; n: number }>();
      for (const g of games) {
        const runs = (g.homeScore ?? 0) + (g.awayScore ?? 0);
        const h = home.get(g.home) ?? { runs: 0, n: 0, venue: new Map() };
        h.runs += runs;
        h.n++;
        const v = h.venue.get(g.venueId) ?? { name: g.venue, n: 0 };
        v.n++;
        h.venue.set(g.venueId, v);
        home.set(g.home, h);
        const a = road.get(g.away) ?? { runs: 0, n: 0 };
        a.runs += runs;
        a.n++;
        road.set(g.away, a);
      }
      for (const [team, h] of home) {
        const a = road.get(team);
        if (!a || h.n < 30 || a.n < 30) continue;
        const [venueId, v] = [...h.venue].sort((x, y) => y[1].n - x[1].n)[0];
        const raw = h.runs / h.n / (a.runs / a.n);
        const entry = per.get(venueId) ?? { venue: v.name, team, factors: [] };
        entry.factors.push(1 + PARK_TRUST * (raw - 1));
        per.set(venueId, entry);
      }
    }
    return [...per]
      .map(([venueId, e]) => ({
        venueId,
        venue: e.venue,
        team: teams.get(e.team)?.abbr ?? '',
        factor: Math.round((e.factors.reduce((a, b) => a + b, 0) / e.factors.length) * 1000) / 1000,
        seasons: e.factors.length,
      }))
      .sort((a, b) => b.factor - a.factor);
  });
}

/** Shrink a rate toward the league with `prior` pseudo-observations. */
const shrink = (x: number, n: number, league: number, prior: number) => (x + league * prior) / (n + prior);
/** log5: a batter-vs-pitcher style combination of two rates relative to the league. */
export const log5 = (a: number, b: number, lg: number) => {
  const num = (a * b) / lg;
  return num / (num + ((1 - a) * (1 - b)) / (1 - lg));
};
/** Pseudo-batters-faced pulling a pitcher's K% toward league (K% stabilizes around ~70 BF). */
export const K_PRIOR_BF = 70;

export type ProbableLine = {
  id: number;
  name: string;
  throws: Hand;
  starts: number;
  ipPerStart: number | null;
  season: PitcherLine;
  last3K: number[];
  /** Opposing lineup vs. his hand. */
  opp: { team: string; kPct: number | null; woba: number | null; kRank: number; wobaRank: number };
  /** Strikeouts expected: his BF per start × log5(his K%, their K% vs his hand). */
  expectedK: number | null;
};

export type MlbGameCard = {
  gamePk: number;
  start: string;
  postseason: boolean;
  venue: string;
  park: number | null;
  away: { team: string; name: string; probable: ProbableLine | null };
  home: { team: string; name: string; probable: ProbableLine | null };
};

export type MlbResearch = {
  sport: 'mlb';
  season: number;
  seasonLabel: string;
  latestSeason: number;
  gamesPlayed: number;
  generatedAt: string;
  league: { kPct: number; woba: number; runsPerGame: number };
  slate: { date: string; games: MlbGameCard[] } | null;
  parks: ParkFactor[];
};

export async function getMlbResearch(season: number): Promise<MlbResearch> {
  const [agg, teams, people, latest, parks] = await Promise.all([
    mlbAggregate(season),
    mlbTeams(season),
    mlbPeople(season),
    latestMlbSeason(),
    parkFactors(season),
  ]);
  const league = emptyLine();
  for (const s of agg.teamBat.values()) addLine(league, s.all);
  const lgK = league.k / (league.pa || 1);
  const totalGames = [...agg.games.values()].reduce((a, b) => a + b, 0) / 2;
  const ids = [...agg.teamBat.keys()];

  const rankBy = (vals: Map<number, number | null>, highFirst: boolean) => {
    const sorted = [...vals].filter(([, v]) => v != null).sort((a, b) => (highFirst ? b[1]! - a[1]! : a[1]! - b[1]!));
    return new Map(sorted.map(([id], i) => [id, i + 1]));
  };
  const vsHand = (hand: Hand) => {
    const k = new Map(ids.map((id) => [id, rate(agg.teamBat.get(id)![hand === 'L' ? 'vsL' : 'vsR'].k, agg.teamBat.get(id)![hand === 'L' ? 'vsL' : 'vsR'].pa)]));
    const w = new Map(ids.map((id) => [id, woba(agg.teamBat.get(id)![hand === 'L' ? 'vsL' : 'vsR'])]));
    return { k, w, kRank: rankBy(k, true), wRank: rankBy(w, true) };
  };
  const byHand = { L: vsHand('L'), R: vsHand('R') };

  const probable = (p: { id: number; name: string } | null, oppTeam: number): ProbableLine | null => {
    if (!p) return null;
    const person = people.get(p.id);
    const stats = agg.pitchers.get(p.id);
    const throws = person?.throws ?? 'R';
    const h = byHand[throws];
    const games = stats ? [...stats.games].sort((a, b) => a.date.localeCompare(b.date)) : [];
    const starts = games.filter((g) => g.started);
    const bfPerStart = starts.length ? starts.reduce((a, g) => a + g.pa, 0) / starts.length : null;
    const all = stats?.split.all;
    const kRate = all ? shrink(all.k, all.pa, lgK, K_PRIOR_BF) : lgK;
    const oppK = h.k.get(oppTeam) ?? lgK;
    return {
      id: p.id,
      name: p.name,
      throws,
      starts: starts.length,
      ipPerStart: starts.length ? r1(starts.reduce((a, g) => a + g.outs, 0) / 3 / starts.length) : null,
      season: pitcherLine(all ?? emptyLine()),
      last3K: starts.slice(-3).reverse().map((g) => g.k),
      opp: {
        team: teams.get(oppTeam)?.abbr ?? '',
        kPct: h.k.get(oppTeam) == null ? null : r1(100 * h.k.get(oppTeam)!),
        woba: r3(h.w.get(oppTeam) ?? null),
        kRank: h.kRank.get(oppTeam) ?? 0,
        wobaRank: h.wRank.get(oppTeam) ?? 0,
      },
      expectedK: bfPerStart && starts.length >= 3 ? r1(bfPerStart * log5(kRate, oppK ?? lgK, lgK)) : null,
    };
  };

  let slate: MlbResearch['slate'] = null;
  if (season === latest) {
    const next = await nextMlbSlate().catch(() => null);
    if (next) {
      const parkBy = new Map(parks.map((p) => [p.venueId, p.factor]));
      const side = (team: number, prob: { id: number; name: string } | null, opp: number) => ({
        team: teams.get(team)?.abbr ?? '',
        name: teams.get(team)?.name ?? '',
        probable: probable(prob, opp),
      });
      slate = {
        date: next.date,
        games: next.games.map((g) => ({
          gamePk: g.gamePk,
          start: g.start,
          postseason: g.type !== 'R',
          venue: g.venue,
          park: parkBy.get(g.venueId) ?? null,
          away: side(g.away, g.awayProbable, g.home),
          home: side(g.home, g.homeProbable, g.away),
        })),
      };
    }
  }

  return {
    sport: 'mlb',
    season,
    seasonLabel: String(season),
    latestSeason: latest,
    gamesPlayed: Math.min(...[...agg.games.values()]),
    generatedAt: new Date().toISOString(),
    league: { kPct: r1(100 * lgK), woba: r3(woba(league)) ?? 0, runsPerGame: r1(league.runs / (totalGames || 1) / 2) },
    slate,
    parks,
  };
}
