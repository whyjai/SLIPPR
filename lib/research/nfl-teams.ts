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
};

export const OFFENSE_METRICS: TendencyMetric[] = [
  { key: 'playsPerGame', label: 'Plays / game', unit: '', highIsFirst: true, hint: 'Offensive snaps per game (runs + dropbacks).' },
  { key: 'pace', label: 'Pace', unit: 'sec', highIsFirst: false, hint: 'Game-clock seconds between snaps in neutral game states. #1 = fastest.' },
  { key: 'neutralPassRate', label: 'Neutral pass rate', unit: '%', highIsFirst: true, hint: 'Pass rate on 1st/2nd down with win probability 20–80%, outside the last 2 minutes of a half.' },
  { key: 'proe', label: 'Pass rate over expected', unit: 'pts', highIsFirst: true, hint: 'How much more (or less) they pass than an average team would in the same situations.' },
  { key: 'shotgunRate', label: 'Shotgun', unit: '%', highIsFirst: true, hint: 'Share of snaps from shotgun.' },
  { key: 'noHuddleRate', label: 'No-huddle', unit: '%', highIsFirst: true, hint: 'Share of snaps with no huddle.' },
  { key: 'playActionRate', label: 'Play-action', unit: '%', highIsFirst: true, hint: 'Share of dropbacks with a play-action fake (charted plays).' },
  { key: 'motionRate', label: 'Pre-snap motion', unit: '%', highIsFirst: true, hint: 'Share of snaps with motion (charted plays).' },
  { key: 'rzPassRate', label: 'Red-zone pass rate', unit: '%', highIsFirst: true, hint: 'Pass rate inside the opponent 20.' },
];

export const DEFENSE_METRICS: TendencyMetric[] = [
  { key: 'blitzRate', label: 'Blitz rate', unit: '%', highIsFirst: true, hint: 'Share of dropbacks with at least one blitzer (charted plays).' },
  { key: 'avgRushers', label: 'Pass rushers', unit: '', highIsFirst: true, hint: 'Average pass rushers per dropback.' },
  { key: 'stackedBoxRate', label: 'Stacked box (8+)', unit: '%', highIsFirst: true, hint: 'Share of opponent runs faced with 8+ defenders in the box.' },
  { key: 'lightBoxRate', label: 'Light box (≤6)', unit: '%', highIsFirst: true, hint: 'Share of opponent runs faced with 6 or fewer in the box.' },
  { key: 'manRate', label: 'Man coverage', unit: '%', highIsFirst: true, hint: 'Share of dropbacks in man coverage.' },
  { key: 'passEpaAllowed', label: 'EPA / dropback allowed', unit: 'EPA', highIsFirst: true, hint: 'Expected points added per opponent dropback. #1 = allows the most.' },
  { key: 'rushEpaAllowed', label: 'EPA / rush allowed', unit: 'EPA', highIsFirst: true, hint: 'Expected points added per opponent run. #1 = allows the most.' },
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
  passing: SplitLine[];
  receiving: SplitLine[];
  rushing: SplitLine[];
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
  const aggs = [await getSeasonAggregate(season)];
  if (STORED[season - 1]) aggs.unshift(await getSeasonAggregate(season - 1));
  return { splits: mergeSplits(...aggs), seasons: aggs.map((a) => a.season) };
}

export function summarizeSplits(
  id: string,
  merged: Awaited<ReturnType<typeof mergedSplits>>,
): PlayerSplits | null {
  const p = merged.splits[id];
  if (!p) return null;
  const passing: SplitLine[] = [];
  const receiving: SplitLine[] = [];
  const rushing: SplitLine[] = [];
  for (const [look, c] of Object.entries(p.splits) as Array<[Look, Record<string, number>]>) {
    const base = { look, label: LOOK_LABEL[look] };
    if (c.dropbacks) {
      passing.push({
        ...base,
        dropbacks: c.dropbacks,
        ypa: c.att ? r1((c.passYds ?? 0) / c.att) : null,
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
  const order: Look[] = ['blitz', 'noBlitz', 'man', 'zone', 'playAction', 'noPlayAction', 'lightBox', 'normalBox', 'stackedBox'];
  const byOrder = (a: SplitLine, b: SplitLine) => order.indexOf(a.look) - order.indexOf(b.look);
  return { playerId: id, name: p.name, seasons: merged.seasons, passing: passing.sort(byOrder), receiving: receiving.sort(byOrder), rushing: rushing.sort(byOrder) };
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
    const on = s?.passing.find((l) => l.look === 'blitz');
    const off = s?.passing.find((l) => l.look === 'noBlitz');
    if (on && off && on.dropbacks! >= 40 && off.dropbacks! >= 40) {
      out.push({
        kind: 'blitz',
        defense,
        offense,
        rank: blitz.rank!,
        text:
          `${nick(defense)} blitz on ${blitz.value}% of dropbacks (${place(blitz.rank!, n, blitz.rank! <= 5)}). ` +
          `${lead.qb.name} ${since}: ${on.ypa} yds/att vs. the blitz, ${off.ypa} without (${on.dropbacks} / ${off.dropbacks} dropbacks).`,
      });
    }
  }

  const stacked = d.defense.stackedBoxRate;
  const light = d.defense.lightBoxRate;
  if (lead.rb) {
    const s = summarizeSplits(lead.rb.id, merged);
    const get = (look: Look) => s?.rushing.find((l) => l.look === look);
    const rest = (looks: Look[]) => {
      const ls = looks.map(get).filter(Boolean) as SplitLine[];
      const carries = ls.reduce((a, l) => a + l.carries!, 0);
      const yds = ls.reduce((a, l) => a + l.carries! * (l.ypc ?? 0), 0);
      return carries ? { carries, ypc: r1(yds / carries) } : null;
    };
    if (stacked.rank != null && stacked.rank <= 5) {
      const on = get('stackedBox');
      const other = rest(['lightBox', 'normalBox']);
      if (on && other && on.carries! >= 10 && other.carries >= 30) {
        out.push({
          kind: 'stackedBox',
          defense,
          offense,
          rank: stacked.rank,
          text:
            `${nick(defense)} put 8+ in the box on ${stacked.value}% of runs (${place(stacked.rank, n, true)}). ` +
            `${lead.rb.name} ${since}: ${on.ypc} yds/carry vs. 8+, ${other.ypc} otherwise (${on.carries} / ${other.carries} carries).`,
        });
      }
    } else if (light.rank != null && light.rank <= 5) {
      const on = get('lightBox');
      const other = rest(['normalBox', 'stackedBox']);
      if (on && other && on.carries! >= 20 && other.carries >= 20) {
        out.push({
          kind: 'lightBox',
          defense,
          offense,
          rank: light.rank,
          text:
            `${nick(defense)} play a light box (≤6) on ${light.value}% of runs (${place(light.rank, n, true)}). ` +
            `${lead.rb.name} ${since}: ${on.ypc} yds/carry vs. light boxes, ${other.ypc} otherwise (${on.carries} / ${other.carries} carries).`,
        });
      }
    }
  }

  const man = d.defense.manRate;
  if (extreme(man.rank) && lead.receiver && tend.coverageSeason) {
    const s = summarizeSplits(lead.receiver.id, merged);
    const vsMan = s?.receiving.find((l) => l.look === 'man');
    const vsZone = s?.receiving.find((l) => l.look === 'zone');
    if (vsMan && vsZone && vsMan.targets! >= 12 && vsZone.targets! >= 25) {
      const label = tend.coverageSeason === tend.season ? '' : ` in ${tend.coverageSeason}`;
      out.push({
        kind: 'coverage',
        defense,
        offense,
        rank: man.rank!,
        text:
          `${nick(defense)} played man coverage on ${man.value}% of dropbacks${label} (${place(man.rank!, n, man.rank! <= 5)}). ` +
          `${lead.receiver.name}: ${vsMan.ypt} yds/target vs. man, ${vsZone.ypt} vs. zone (${vsMan.targets} / ${vsZone.targets} targets).`,
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
