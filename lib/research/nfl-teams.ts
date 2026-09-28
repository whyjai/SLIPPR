import { aggregate, loadCharting, loadCoverage, loadPlays, mergeSplits, type Look, type SeasonAggregate } from './nfl-pbp';
import { schedule, TEAM_NAMES } from './nflverse';

/**
 * Team tendencies and player splits vs. defensive looks, from play-level data.
 * Finished seasons are read from a stored aggregate (scripts/research/
 * build-nfl-season.mts); the current season is computed live and cached.
 */

const STORED: Record<number, () => Promise<SeasonAggregate>> = {
  2025: () => import('../../data/research/nfl-2025.json').then((m) => m.default as unknown as SeasonAggregate),
};

const TTL_MS = 60 * 60 * 1000;
const liveCache = new Map<number, { at: number; data: Promise<SeasonAggregate> }>();

export function getSeasonAggregate(season: number): Promise<SeasonAggregate> {
  const stored = STORED[season];
  if (stored) return stored();
  const hit = liveCache.get(season);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = (async () => {
    const [plays, charting, coverage, games] = await Promise.all([
      loadPlays(season),
      loadCharting(season).catch(() => new Map()),
      loadCoverage(season).catch(() => new Map<string, 'man' | 'zone'>()), // not published until after the season
      schedule(season),
    ]);
    // Only final games: nflverse loads game-day play-by-play while games are in progress.
    const final = new Set(games.filter((g) => g.homeScore != null).map((g) => g.gameId));
    return aggregate(season, plays.filter((p) => final.has(p.gameId)), charting, coverage);
  })().catch((err) => {
    liveCache.delete(season);
    throw err;
  });
  liveCache.set(season, { at: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------------------
// Team tendencies
// ---------------------------------------------------------------------------

export type TendencyMetric = {
  key: string;
  label: string;
  unit: '%' | 'sec' | 'pts' | '' | 'EPA';
  /** true: #1 = highest value. false: #1 = lowest (e.g. pace: fewest seconds per snap = fastest). */
  highIsFirst: boolean;
  hint: string;
  /** From FTN charting, which runs a few days behind box scores. */
  charted?: boolean;
};

export const OFFENSE_METRICS: TendencyMetric[] = [
  { key: 'playsPerGame', label: 'Plays / game', unit: '', highIsFirst: true, hint: 'Offensive snaps per game (runs + dropbacks).' },
  { key: 'pace', label: 'Pace', unit: 'sec', highIsFirst: false, hint: 'Game-clock seconds between snaps while the clock keeps running, neutral game states. #1 = fastest.' },
  { key: 'neutralPassRate', label: 'Neutral pass rate', unit: '%', highIsFirst: true, hint: 'Dropback rate (incl. sacks and scrambles) on 1st/2nd down with win probability 20–80%, outside the last 2 minutes of a half.' },
  { key: 'proe', label: 'Pass rate over expected', unit: 'pts', highIsFirst: true, hint: 'How much more (or less) they pass than an average team would in the same situations.' },
  { key: 'shotgunRate', label: 'Shotgun', unit: '%', highIsFirst: true, hint: 'Share of snaps from shotgun.' },
  { key: 'noHuddleRate', label: 'No-huddle', unit: '%', highIsFirst: true, hint: 'Share of snaps with no huddle.' },
  { key: 'playActionRate', charted: true, label: 'Play-action', unit: '%', highIsFirst: true, hint: 'Share of dropbacks with a play-action fake (charted plays).' },
  { key: 'motionRate', charted: true, label: 'Pre-snap motion', unit: '%', highIsFirst: true, hint: 'Share of snaps with motion (charted plays).' },
  { key: 'rzPassRate', label: 'Red-zone pass rate', unit: '%', highIsFirst: true, hint: 'Dropback rate inside the opponent 20.' },
];

export const DEFENSE_METRICS: TendencyMetric[] = [
  { key: 'blitzRate', charted: true, label: 'Blitz rate', unit: '%', highIsFirst: true, hint: 'Share of dropbacks with at least one blitzer (charted plays).' },
  { key: 'avgRushers', charted: true, label: 'Pass rushers', unit: '', highIsFirst: true, hint: 'Average pass rushers per dropback.' },
  { key: 'stackedBoxRate', charted: true, label: 'Stacked box (8+)', unit: '%', highIsFirst: true, hint: 'Share of opponent designed runs faced with 8+ defenders in the box.' },
  { key: 'lightBoxRate', charted: true, label: 'Light box (≤6)', unit: '%', highIsFirst: true, hint: 'Share of opponent designed runs faced with 6 or fewer in the box.' },
  { key: 'manRate', label: 'Man coverage', unit: '%', highIsFirst: true, hint: 'Share of dropbacks in man coverage.' },
  { key: 'passEpaAllowed', label: 'EPA / dropback allowed', unit: 'EPA', highIsFirst: true, hint: 'Expected points added per opponent dropback. #1 = allows the most.' },
  { key: 'rushEpaAllowed', label: 'EPA / rush allowed', unit: 'EPA', highIsFirst: true, hint: 'Expected points added per opponent designed run. #1 = allows the most.' },
  { key: 'yardsPerPlayAllowed', label: 'Yards / play allowed', unit: '', highIsFirst: true, hint: 'Opponent yards per play. #1 = allows the most.' },
];

export type Cell = { value: number | null; rank: number | null };

export type TeamTendency = {
  team: string;
  name: string;
  games: number;
  offense: Record<string, Cell>;
  defense: Record<string, Cell>;
};

export type NflTeamTendencies = {
  season: number;
  throughWeek: number;
  /** Charted metrics (blitz, box, play-action, motion) run behind; see SeasonAggregate. */
  chartedThroughWeek: number;
  chartedPartialGames: number;
  hasCharting: boolean;
  /** Season the man-coverage column comes from (the current season's isn't published until it ends). */
  coverageSeason: number | null;
  offenseMetrics: TendencyMetric[];
  defenseMetrics: TendencyMetric[];
  teams: TeamTendency[];
  leagueAvg: { offense: Record<string, number | null>; defense: Record<string, number | null> };
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (a: number | undefined, b: number | undefined, mult = 100, round = r1) => (b ? round(((a ?? 0) / b) * mult) : null);

function rawTendencies(agg: SeasonAggregate, coverageAgg: SeasonAggregate | null) {
  return Object.entries(agg.teams)
    .filter(([t]) => TEAM_NAMES[t])
    .map(([team, c]) => {
      const o = c.offense;
      const d = c.defense;
      const g = c.games.length || 1;
      const cov = coverageAgg?.teams[team]?.defense;
      return {
        team,
        name: `${TEAM_NAMES[team].city} ${TEAM_NAMES[team].nickname}`,
        games: c.games.length,
        offense: {
          playsPerGame: r1((o.plays ?? 0) / g),
          pace: ratio(o.paceSum, o.paceN, 1),
          neutralPassRate: ratio(o.neutralPass, o.neutralPlays),
          proe: ratio(o.passOeSum, o.passOeN, 1),
          shotgunRate: ratio(o.shotgun, o.plays),
          noHuddleRate: ratio(o.noHuddle, o.plays),
          playActionRate: ratio(o.playAction, o.chartedDropbacks),
          motionRate: ratio(o.motion, o.charted),
          rzPassRate: ratio(o.rzPass, o.rzPlays),
        } as Record<string, number | null>,
        defense: {
          blitzRate: ratio(d.blitzes, d.chartedDropbacks),
          avgRushers: ratio(d.rushersSum, d.rushersN, 1, r2),
          stackedBoxRate: ratio(d.stackedBox, d.boxRuns),
          lightBoxRate: ratio(d.lightBox, d.boxRuns),
          manRate: cov ? ratio(cov.man, cov.coverageSnaps) : null,
          passEpaAllowed: ratio(d.passEpa, d.passPlays, 1, r2),
          rushEpaAllowed: ratio(d.rushEpa, d.runPlays, 1, r2),
          yardsPerPlayAllowed: ratio(d.yards, d.plays, 1, r2),
        } as Record<string, number | null>,
      };
    });
}

function rank(rows: Array<{ team: string; values: Record<string, number | null> }>, metrics: TendencyMetric[]) {
  const out: Record<string, Record<string, Cell>> = {};
  for (const r of rows) out[r.team] = {};
  const avg: Record<string, number | null> = {};
  for (const m of metrics) {
    const valid = rows.filter((r) => r.values[m.key] != null);
    const sorted = [...valid].sort((a, b) => (m.highIsFirst ? 1 : -1) * ((b.values[m.key] as number) - (a.values[m.key] as number)));
    sorted.forEach((r, i) => {
      const prev = sorted[i - 1];
      const tie = prev && prev.values[m.key] === r.values[m.key];
      out[r.team][m.key] = { value: r.values[m.key], rank: tie ? out[prev.team][m.key].rank : i + 1 };
    });
    for (const r of rows) out[r.team][m.key] ??= { value: null, rank: null };
    avg[m.key] = valid.length ? r2(valid.reduce((s, r) => s + (r.values[m.key] as number), 0) / valid.length) : null;
  }
  return { cells: out, avg };
}

export async function getNflTeamTendencies(season: number): Promise<NflTeamTendencies> {
  const agg = await getSeasonAggregate(season);
  // Man/zone only exists after a season ends; for a live season, show last season's (labeled).
  let coverageAgg: SeasonAggregate | null = agg.hasCoverage ? agg : null;
  if (!coverageAgg && STORED[season - 1]) {
    const prev = await getSeasonAggregate(season - 1);
    if (prev.hasCoverage) coverageAgg = prev;
  }
  const raw = rawTendencies(agg, coverageAgg);
  const off = rank(raw.map((r) => ({ team: r.team, values: r.offense })), OFFENSE_METRICS);
  const def = rank(raw.map((r) => ({ team: r.team, values: r.defense })), DEFENSE_METRICS);
  return {
    season,
    throughWeek: agg.throughWeek,
    chartedThroughWeek: agg.chartedThroughWeek ?? agg.throughWeek,
    chartedPartialGames: agg.chartedPartialGames ?? 0,
    hasCharting: agg.hasCharting,
    coverageSeason: coverageAgg?.season ?? null,
    offenseMetrics: OFFENSE_METRICS,
    defenseMetrics: DEFENSE_METRICS,
    teams: raw
      .map((r) => ({ team: r.team, name: r.name, games: r.games, offense: off.cells[r.team], defense: def.cells[r.team] }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    leagueAvg: { offense: off.avg, defense: def.avg },
  };
}

// ---------------------------------------------------------------------------
// Player splits vs. defensive looks
// ---------------------------------------------------------------------------

export type SplitLine = {
  look: Look;
  label: string;
  // passing
  dropbacks?: number;
  ypa?: number | null; // passing yards per attempt
  ypd?: number | null; // yards per dropback, sacks and scrambles included
  compPct?: number | null;
  epaPerDropback?: number | null;
  // receiving
  targets?: number;
  catchRate?: number | null;
  ypt?: number | null; // receiving yards per target
  // rushing
  carries?: number;
  ypc?: number | null;
};

export type PlayerSplits = {
  playerId: string;
  name: string;
  seasons: number[];
  /** Current season's charting coverage (splits need charted plays). */
  chartedThrough?: { season: number; week: number; partialGames: number };
  passing: SplitLine[];
  receiving: SplitLine[];
  rushing: SplitLine[];
  /** Every player's plays summed: what each look does league-wide. */
  league?: { passing: SplitLine[]; receiving: SplitLine[]; rushing: SplitLine[] };
};

const LOOK_LABEL: Record<Look, string> = {
  blitz: 'vs. blitz',
  noBlitz: 'vs. no blitz',
  playAction: 'with play-action',
  noPlayAction: 'without play-action',
  man: 'vs. man coverage',
  zone: 'vs. zone coverage',
  lightBox: 'vs. light box (≤6)',
  normalBox: 'vs. 7 in the box',
  stackedBox: 'vs. stacked box (8+)',
};

/** Stored last season + live current season, summed. */
export async function mergedSplits(season: number) {
  const cur = await getSeasonAggregate(season);
  const aggs = [cur];
  if (STORED[season - 1]) aggs.unshift(await getSeasonAggregate(season - 1));
  const chartedThrough = { season, week: cur.chartedThroughWeek ?? cur.throughWeek, partialGames: cur.chartedPartialGames ?? 0 };
  const splits = mergeSplits(...aggs);
  // Passing stats live only on passers, receiving on receivers, rushing on rushers, so a plain sum is league-wide.
  const league: Partial<Record<Look, Record<string, number>>> = {};
  for (const p of Object.values(splits)) {
    for (const [look, c] of Object.entries(p.splits) as Array<[Look, Record<string, number>]>) {
      const t = (league[look] ??= {});
      for (const [k, v] of Object.entries(c)) t[k] = (t[k] ?? 0) + v;
    }
  }
  return { splits, league, seasons: aggs.map((a) => a.season), chartedThrough };
}

const LOOK_ORDER: Look[] = ['blitz', 'noBlitz', 'man', 'zone', 'playAction', 'noPlayAction', 'lightBox', 'normalBox', 'stackedBox'];

function splitLines(splits: Partial<Record<Look, Record<string, number>>>) {
  const passing: SplitLine[] = [];
  const receiving: SplitLine[] = [];
  const rushing: SplitLine[] = [];
  for (const [look, c] of Object.entries(splits) as Array<[Look, Record<string, number>]>) {
    const base = { look, label: LOOK_LABEL[look] };
    if (c.dropbacks) {
      passing.push({
        ...base,
        dropbacks: c.dropbacks,
        ypa: c.att ? r1((c.passYds ?? 0) / c.att) : null,
        ypd: r1((c.dbYards ?? 0) / c.dropbacks),
        compPct: c.att ? Math.round(((c.comp ?? 0) / c.att) * 100) : null,
        epaPerDropback: r2((c.epa ?? 0) / c.dropbacks),
      });
    }
    if (c.targets) {
      receiving.push({
        ...base,
        targets: c.targets,
        catchRate: Math.round(((c.rec ?? 0) / c.targets) * 100),
        ypt: r1((c.recYds ?? 0) / c.targets),
      });
    }
    if (c.carries) rushing.push({ ...base, carries: c.carries, ypc: r1((c.rushYds ?? 0) / c.carries) });
  }
  const byOrder = (a: SplitLine, b: SplitLine) => LOOK_ORDER.indexOf(a.look) - LOOK_ORDER.indexOf(b.look);
  return { passing: passing.sort(byOrder), receiving: receiving.sort(byOrder), rushing: rushing.sort(byOrder) };
}

export function summarizeSplits(
  id: string,
  merged: Awaited<ReturnType<typeof mergedSplits>>,
): PlayerSplits | null {
  const p = merged.splits[id];
  if (!p) return null;
  const mine = splitLines(p.splits);
  const league = splitLines(merged.league);
  return { playerId: id, name: p.name, seasons: merged.seasons, chartedThrough: merged.chartedThrough, ...mine, league };
}

// ---------------------------------------------------------------------------
// Scheme matchup notes: how a defense lines up × how the opposing player
// performs against that look.
// ---------------------------------------------------------------------------

export type SchemeNote = {
  kind: 'blitz' | 'stackedBox' | 'lightBox' | 'coverage';
  defense: string;
  offense: string;
  rank: number;
  text: string;
};

type Leader = { id: string; name: string };
type BoxWeek = { playerId: string; name: string; team: string; position: string; seasonType: string; [k: string]: unknown };

function leaders(weeks: BoxWeek[], team: string) {
  const tally = (pos: string[], stat: string) => {
    const t = new Map<string, { name: string; n: number }>();
    for (const w of weeks) {
      if (w.team !== team || w.seasonType !== 'REG' || !pos.includes(w.position)) continue;
      const cur = t.get(w.playerId) ?? { name: w.name, n: 0 };
      cur.n += Number(w[stat] ?? 0);
      t.set(w.playerId, cur);
    }
    const best = [...t.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    return best && best[1].n > 0 ? ({ id: best[0], name: best[1].name } as Leader) : null;
  };
  return { qb: tally(['QB'], 'attempts'), rb: tally(['RB', 'FB'], 'carries'), receiver: tally(['WR', 'TE'], 'targets') };
}

const nick = (t: string) => TEAM_NAMES[t]?.nickname ?? t;
const place = (rank: number, n: number, most: boolean) =>
  most ? `#${rank} most` : `#${n - rank + 1} least`;

/**
 * How much of a player's own split (vs. a look) to believe, as a sample size
 * m: weight = h / (h + m), h = harmonic mean of his on/off samples. Measured
 * on 2025 by splitting each player's season in halves, odd/even weeks and
 * thirds (scripts/research/audit-nfl.mts): QB blitz splits didn't repeat
 * (r -0.16 to 0.14), receiver man/zone barely (0.01-0.09, m ~200), RB
 * stacked-box was unstable (-0.06 to 0.53 on ~13 carries), RB light-box held
 * modestly (0.17-0.33, m ~80-250).
 * Everything else is the league-wide effect of the look, which is large.
 */
const SPLIT_TRUST = { qbBlitz: Infinity, recMan: 200, rbStacked: 200, rbLight: 100 } as const;

type Side = { rate: number; n: number };

/**
 * Expected rate for a player vs. a look: his overall rate plus the league's
 * on-minus-off gap, nudged toward his own gap by how much his sample earns.
 */
function expectVsLook(on: Side, off: Side, lgOn: number, lgOff: number, m: number) {
  const h = 2 / (1 / on.n + 1 / off.n);
  const weight = Number.isFinite(m) ? h / (h + m) : 0;
  const gap = lgOn - lgOff + weight * (on.rate - off.rate - (lgOn - lgOff));
  const overall = (on.rate * on.n + off.rate * off.n) / (on.n + off.n);
  return { overall: r1(overall), expected: r1(overall + (off.n / (on.n + off.n)) * gap), weight };
}

/** Only worth a note when the look moves his expectation this much (yards per dropback / carry / target). */
const MIN_EFFECT = 0.3;
const matters = (e: { overall: number; expected: number }) => Math.abs(e.expected - e.overall) >= MIN_EFFECT;

const ownSplit = (weight: number) =>
  weight < 0.25 ? 'is mostly sample noise' : `counts for about ${Math.round(weight * 100)}% after sample-size adjustment`;

/** Merge split lines (e.g. light + normal box) into one carries-weighted side. */
function combine(lines: Array<SplitLine | undefined>, n: (l: SplitLine) => number, rate: (l: SplitLine) => number | null | undefined) {
  const ls = lines.filter((l): l is SplitLine => !!l && rate(l) != null);
  const total = ls.reduce((a, l) => a + n(l), 0);
  return total ? { rate: ls.reduce((a, l) => a + n(l) * (rate(l) as number), 0) / total, n: total } : null;
}

/** Up to three scheme notes for one offense facing one defense. */
function sideNotes(
  offense: string,
  defense: string,
  tend: NflTeamTendencies,
  merged: Awaited<ReturnType<typeof mergedSplits>>,
  weeks: BoxWeek[],
): SchemeNote[] {
  const d = tend.teams.find((t) => t.team === defense);
  if (!d) return [];
  const n = tend.teams.length;
  const lead = leaders(weeks, offense);
  const since = `since ${merged.seasons[0]}`;
  const out: SchemeNote[] = [];
  const extreme = (rank: number | null) => rank != null && (rank <= 5 || rank >= n - 4);

  const blitz = d.defense.blitzRate;
  if (extreme(blitz.rank) && lead.qb) {
    const s = summarizeSplits(lead.qb.id, merged);
    const line = (ls: SplitLine[] | undefined, look: Look) => ls?.find((l) => l.look === look);
    const on = line(s?.passing, 'blitz');
    const off = line(s?.passing, 'noBlitz');
    const lgOn = line(s?.league?.passing, 'blitz')?.ypd;
    const lgOff = line(s?.league?.passing, 'noBlitz')?.ypd;
    if (on?.ypd != null && off?.ypd != null && lgOn != null && lgOff != null && on.dropbacks! >= 40 && off.dropbacks! >= 40) {
      const e = expectVsLook({ rate: on.ypd, n: on.dropbacks! }, { rate: off.ypd, n: off.dropbacks! }, lgOn, lgOff, SPLIT_TRUST.qbBlitz);
      if (matters(e)) out.push({
        kind: 'blitz',
        defense,
        offense,
        rank: blitz.rank!,
        text:
          `${nick(defense)} blitz on ${blitz.value}% of dropbacks (${place(blitz.rank!, n, blitz.rank! <= 5)}). ` +
          `League-wide, QBs gain ${lgOn} yds/dropback vs. the blitz and ${lgOff} without. ` +
          `${lead.qb.name}: expect about ${e.expected} vs. the blitz (${e.overall} overall). His own ${on.ypd} vs. ${off.ypd} ` +
          `${since} (${on.dropbacks} / ${off.dropbacks} dropbacks) ${ownSplit(e.weight)}.`,
      });
    }
  }

  const stacked = d.defense.stackedBoxRate;
  const light = d.defense.lightBoxRate;
  if (lead.rb) {
    const s = summarizeSplits(lead.rb.id, merged);
    const get = (ls: SplitLine[] | undefined, look: Look) => ls?.find((l) => l.look === look);
    const side = (ls: SplitLine[] | undefined, looks: Look[]) => combine(looks.map((l) => get(ls, l)), (l) => l.carries!, (l) => l.ypc);
    const note = (kind: 'stackedBox' | 'lightBox', rank: number, value: number | null, look: Look, rest: Look[], minOn: number, minOff: number) => {
      const on = side(s?.rushing, [look]);
      const off = side(s?.rushing, rest);
      const lgOn = side(s?.league?.rushing, [look]);
      const lgOff = side(s?.league?.rushing, rest);
      if (!on || !off || !lgOn || !lgOff || on.n < minOn || off.n < minOff) return;
      const e = expectVsLook(on, off, lgOn.rate, lgOff.rate, kind === 'stackedBox' ? SPLIT_TRUST.rbStacked : SPLIT_TRUST.rbLight);
      if (!matters(e)) return;
      const lookText = kind === 'stackedBox' ? '8+ in the box' : 'light boxes';
      out.push({
        kind,
        defense,
        offense,
        rank,
        text:
          `${nick(defense)} ${kind === 'stackedBox' ? 'put 8+ in the box' : 'play a light box (≤6)'} on ${value}% of runs (${place(rank, n, true)}). ` +
          `League-wide, runs gain ${r1(lgOn.rate)} yds/carry vs. ${lookText} and ${r1(lgOff.rate)} otherwise. ` +
          `${lead.rb!.name}: expect about ${e.expected} vs. ${lookText} (${e.overall} overall). His own ${r1(on.rate)} vs. ${r1(off.rate)} ` +
          `${since} (${on.n} / ${off.n} carries) ${ownSplit(e.weight)}.`,
      });
    };
    if (stacked.rank != null && stacked.rank <= 5) note('stackedBox', stacked.rank, stacked.value, 'stackedBox', ['lightBox', 'normalBox'], 10, 30);
    else if (light.rank != null && light.rank <= 5) note('lightBox', light.rank, light.value, 'lightBox', ['normalBox', 'stackedBox'], 20, 20);
  }

  const man = d.defense.manRate;
  if (extreme(man.rank) && lead.receiver && tend.coverageSeason) {
    const s = summarizeSplits(lead.receiver.id, merged);
    const line = (ls: SplitLine[] | undefined, look: Look) => ls?.find((l) => l.look === look);
    const vsMan = line(s?.receiving, 'man');
    const vsZone = line(s?.receiving, 'zone');
    const lgMan = line(s?.league?.receiving, 'man')?.ypt;
    const lgZone = line(s?.league?.receiving, 'zone')?.ypt;
    if (vsMan?.ypt != null && vsZone?.ypt != null && lgMan != null && lgZone != null && vsMan.targets! >= 12 && vsZone.targets! >= 25) {
      const e = expectVsLook({ rate: vsMan.ypt, n: vsMan.targets! }, { rate: vsZone.ypt, n: vsZone.targets! }, lgMan, lgZone, SPLIT_TRUST.recMan);
      if (!matters(e)) return out;
      const label = tend.coverageSeason === tend.season ? '' : ` in ${tend.coverageSeason}`;
      out.push({
        kind: 'coverage',
        defense,
        offense,
        rank: man.rank!,
        text:
          `${nick(defense)} played man coverage on ${man.value}% of dropbacks${label} (${place(man.rank!, n, man.rank! <= 5)}). ` +
          `League-wide, targets gain ${lgMan} yds vs. man and ${lgZone} vs. zone. ` +
          `${lead.receiver.name}: expect about ${e.expected} yds/target vs. man (${e.overall} overall). His own ${vsMan.ypt} vs. ${vsZone.ypt} ` +
          `(${vsMan.targets} / ${vsZone.targets} targets) ${ownSplit(e.weight)}.`,
      });
    }
  }
  return out;
}

/** Scheme notes for each upcoming game, keyed by gameId. Never throws: play-level data is a bonus. */
export async function schemeNotesFor(
  season: number,
  games: Array<{ gameId: string; away: string; home: string }>,
  weeks: BoxWeek[],
): Promise<Map<string, SchemeNote[]>> {
  const out = new Map<string, SchemeNote[]>();
  try {
    const [tend, merged] = await Promise.all([getNflTeamTendencies(season), mergedSplits(season)]);
    for (const g of games) {
      out.set(g.gameId, [...sideNotes(g.away, g.home, tend, merged, weeks), ...sideNotes(g.home, g.away, tend, merged, weeks)]);
    }
  } catch {
    // play-by-play unavailable: the box-score notes still stand on their own
  }
  return out;
}
