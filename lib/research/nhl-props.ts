/**
 * NHL prop cheat sheet: skater shots on goal, points, goals and assists, and
 * goalie saves, with a calibrated baseline and outcome spread
 * (scripts/research/calibrate-nhl-props.mts).
 */
import NHL_SPREAD from '../../data/research/nhl-prop-spread.json';
import {
  nameKey,
  nhlGoalieGames,
  nhlInjuries,
  nhlRoster,
  nhlSeasonFor,
  nhlSkaterGames,
  nextNhlSlate,
  type NhlGoalieGame,
  type NhlSkaterGame,
} from './nhl-data';
import { blendBaseline, chanceOver, outcomeAt, type BaselineParams, type SpreadModel } from './props-engine';

export type NhlStat = 'shots' | 'points' | 'goals' | 'assists' | 'saves';
export const NHL_STATS: NhlStat[] = ['shots', 'points', 'goals', 'assists', 'saves'];
export const NHL_STAT_LABEL: Record<NhlStat, string> = {
  shots: 'Shots on goal',
  points: 'Points',
  goals: 'Goals',
  assists: 'Assists',
  saves: 'Saves',
};

/** A stat is a prop (and the calibrated chances apply) only above these baselines. */
export const NHL_MIN_BASE: Record<NhlStat, number> = {
  shots: 1.5,
  points: 0.35,
  goals: 0.15,
  assists: 0.2,
  saves: 18,
};

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

type SpreadFile = SpreadModel & {
  baseline: BaselineParams;
  earlyGames: number;
  fitSeasons: number[];
};
const SPREAD = NHL_SPREAD as unknown as SpreadFile;

export const NHL_PROP_MODEL =
  'nhl-1: baseline last 5 @0.25 + last season as 40 games; spread pooled 2021-26 by volume (saves: last 2 seasons), early-season spread';

const r1 = (n: number) => Math.round(n * 10) / 10;

export type NhlPropLine = {
  stat: NhlStat;
  label: string;
  base: number;
  median: number;
  low: number;
  high: number;
  lines: Array<{ line: number; chance: number; hits: number; games: number }>;
};

export type NhlPropPlayer = {
  id: string;
  name: string;
  pos: string | null;
  minutes: number; // time on ice per game
  gamesThisSeason: number;
  injury: { status: string; note: string } | null;
  props: NhlPropLine[];
};

export type NhlPropSheet = {
  model: string;
  league: 'nhl';
  season: number;
  date: string | null;
  generatedAt: string;
  games: Array<{
    id: string;
    tipoff: string;
    away: string;
    home: string;
    sides: Array<{
      team: string;
      opp: string;
      players: NhlPropPlayer[];
      out: Array<{ name: string; status: string; note: string }>;
    }>;
  }>;
};

/** Lines shown per stat: shots and saves around the median, counting stats at the usual 0.5 / 1.5. */
function linesFor(stat: NhlStat, median: number): number[] {
  const mid = Math.max(0.5, Math.round(median) - 0.5);
  if (stat === 'shots') return [mid - 1, mid, mid + 1].filter((l) => l > 0);
  if (stat === 'saves') return [mid - 3, mid, mid + 3];
  return stat === 'points' ? [0.5, 1.5] : [0.5];
}
const ruledOut = (s: string | undefined) => !!s && /out|injured reserve|suspen/i.test(s);

export async function getNhlPropSheet(): Promise<NhlPropSheet> {
  const season = nhlSeasonFor();
  const slate = await nextNhlSlate();
  const [sk, gk, skPrev, gkPrev, injury] = await Promise.all([
    nhlSkaterGames(season).catch(() => [] as NhlSkaterGame[]),
    nhlGoalieGames(season).catch(() => [] as NhlGoalieGame[]),
    nhlSkaterGames(season - 1),
    nhlGoalieGames(season - 1),
    nhlInjuries().catch(() => new Map<string, { status: string; note: string }>()),
  ]);
  const group = <T extends { playerId: number; date: string }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) (m.get(r.playerId) ?? m.set(r.playerId, []).get(r.playerId)!).push(r);
    for (const l of m.values()) l.sort((a, b) => a.date.localeCompare(b.date));
    return m;
  };
  const skBy = group(sk),
    skPrevBy = group(skPrev);
  const gkBy = group(gk.filter((g) => g.started)),
    gkPrevBy = group(gkPrev.filter((g) => g.started));
  // Last season's average, used once he has 20 games (as in calibration).
  const prior = <T>(gs: T[] | undefined, f: (g: T) => number) => (gs && gs.length >= 20 ? gs.reduce((a, g) => a + f(g), 0) / gs.length : null);

  const prop = (stat: NhlStat, values: number[], priorAvg: number | null, recent: number[], early: boolean): NhlPropLine | null => {
    const base = blendBaseline(values, priorAvg, SPREAD.baseline);
    if (base == null || base < NHL_MIN_BASE[stat]) return null;
    const key = `${early ? 'early|' : ''}${stat}`;
    const median = outcomeAt(SPREAD, key, base, 0.5) ?? base;
    return {
      stat,
      label: NHL_STAT_LABEL[stat],
      base: r1(base),
      median: r1(median),
      low: r1(outcomeAt(SPREAD, key, base, 0.25) ?? base),
      high: r1(outcomeAt(SPREAD, key, base, 0.75) ?? base),
      lines: linesFor(stat, median).map((line) => ({
        line,
        chance: Math.round(100 * (chanceOver(SPREAD, key, base, line) ?? 0)),
        hits: recent.filter((v) => v > line).length,
        games: recent.length,
      })),
    };
  };

  const side = async (team: string, opp: string) => {
    const ids = await nhlRoster(team).catch(() => new Set<number>());
    const out: Array<{ name: string; status: string; note: string }> = [];
    const skaters: NhlPropPlayer[] = [];
    let goalie: (NhlPropPlayer & { recentStarts: number }) | null = null;
    for (const id of ids) {
      const games = skBy.get(id) ?? [];
      const prev = skPrevBy.get(id) ?? [];
      const starts = gkBy.get(id) ?? [];
      const prevStarts = gkPrevBy.get(id) ?? [];
      const last = games.at(-1) ?? prev.at(-1) ?? starts.at(-1) ?? prevStarts.at(-1);
      if (!last) continue;
      const inj = injury.get(nameKey(last.name)) ?? null;
      if (starts.length || prevStarts.length) {
        // Goalies: saves, for the one who started most of his team's last 5 games.
        const teamStarts = [...gk.filter((g) => g.team === team && g.started)].sort((a, b) => a.date.localeCompare(b.date)).slice(-5);
        const recentStarts = teamStarts.filter((g) => g.playerId === id).length;
        if (inj && ruledOut(inj.status)) {
          out.push({ name: last.name, status: inj.status, note: inj.note });
          continue;
        }
        const p = prop(
          'saves',
          starts.map((g) => g.saves),
          prior(prevStarts, (g) => g.saves),
          [...prevStarts, ...starts].slice(-10).map((g) => g.saves),
          starts.length < SPREAD.earlyGames,
        );
        if (
          p &&
          (!goalie ||
            recentStarts > goalie.recentStarts ||
            (recentStarts === goalie.recentStarts && starts.length + prevStarts.length > goalie.gamesThisSeason))
        )
          goalie = {
            id: String(id),
            name: last.name,
            pos: 'G',
            minutes: 60,
            gamesThisSeason: starts.length,
            injury: inj,
            props: [p],
            recentStarts,
          };
        continue;
      }
      const toi = blendBaseline(
        games.map((g) => g.toi),
        prior(prev, (g) => g.toi),
        { ...SPREAD.baseline, minGames: 1 },
      );
      if (toi == null || toi < 12) continue;
      if (inj && ruledOut(inj.status)) {
        out.push({ name: last.name, status: inj.status, note: inj.note });
        continue;
      }
      const early = games.length < SPREAD.earlyGames;
      const props = (['shots', 'points', 'goals', 'assists'] as NhlStat[])
        .map((st) =>
          prop(
            st,
            games.map((g) => g[st as 'shots']),
            prior(prev, (g) => g[st as 'shots']),
            [...prev, ...games].slice(-10).map((g) => g[st as 'shots']),
            early,
          ),
        )
        .filter((p): p is NhlPropLine => p != null);
      if (props.length)
        skaters.push({
          id: String(id),
          name: last.name,
          pos: (last as NhlSkaterGame).pos ?? null,
          minutes: r1(toi),
          gamesThisSeason: games.length,
          injury: inj,
          props,
        });
    }
    skaters.sort((a, b) => b.minutes - a.minutes);
    const players = skaters.slice(0, 9);
    if (goalie) {
      const { recentStarts, ...g } = goalie;
      players.push({
        ...g,
        pos: recentStarts ? `G · started ${recentStarts} of last 5` : 'G',
      });
    }
    return { team, opp, players, out };
  };

  const games = [];
  for (const g of slate?.games ?? [])
    games.push({
      id: String(g.id),
      tipoff: g.start,
      away: g.away,
      home: g.home,
      sides: [await side(g.away, g.home), await side(g.home, g.away)],
    });
  return {
    model: NHL_PROP_MODEL,
    league: 'nhl',
    season,
    date: slate?.date ?? null,
    generatedAt: new Date().toISOString(),
    games,
  };
}
