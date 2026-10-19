/**
 * Basketball (NBA / WNBA) prop cheat sheet: for each game on the next slate,
 * each rotation player's points, rebounds, assists, threes and PRA, with a
 * baseline (this season, blended with last season early on), the calibrated
 * spread of outcomes and the chance of going over lines near the median.
 * Recipe and spreads come from scripts/research/calibrate-hoops-props.mts.
 */
import NBA_SPREAD from '../../data/research/nba-prop-spread.json';
import WNBA_SPREAD from '../../data/research/wnba-prop-spread.json';
import { cached } from './csv';
import { latestSeason, LEAGUES, nextSlate, playerGames, roster, seasonFor } from './hoops-data';
import { blendBaseline, chanceOver, outcomeAt, type BaselineParams, type SpreadModel } from './props-engine';
import type { HoopsPlayerGame, League } from './hoops-data';

export type HoopsStat = 'pts' | 'reb' | 'ast' | 'fg3m' | 'pra';
export const HOOPS_STATS: HoopsStat[] = ['pts', 'reb', 'ast', 'fg3m', 'pra'];
export const HOOPS_STAT_LABEL: Record<HoopsStat, string> = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', fg3m: '3-pointers', pra: 'Pts+Reb+Ast' };

export const hoopsStat = (g: Pick<HoopsPlayerGame, 'pts' | 'reb' | 'ast' | 'fg3m'>, s: HoopsStat) =>
  s === 'pra' ? g.pts + g.reb + g.ast : g[s];

/** A stat is a prop (and the calibrated chances apply) only above these baselines. */
export const HOOPS_MIN_BASE: Record<League, Record<HoopsStat, number>> = {
  nba: { pts: 8, reb: 3, ast: 2, fg3m: 0.8, pra: 13 },
  wnba: { pts: 6, reb: 2.5, ast: 1.5, fg3m: 0.6, pra: 10 },
};

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

type SpreadFile = SpreadModel & { baseline: BaselineParams; earlyGames: number; fitSeasons: number[] };
/** Each league's own calibration (scripts/research/calibrate-hoops-props.mts); the NBA's stands in for a league without one. */
const SPREADS: Partial<Record<League, SpreadFile>> = { nba: NBA_SPREAD as unknown as SpreadFile, wnba: WNBA_SPREAD as unknown as SpreadFile };
const spreadOf = (league: League) => SPREADS[league] ?? SPREADS.nba!;

export const HOOPS_PROP_MODEL = 'hoops-1: baseline last 10 @0.5 + last season as 6 games; spread pooled 2022-26 by volume, early-season spread';

const STEP: Record<HoopsStat, number> = { pts: 2, reb: 1, ast: 1, fg3m: 1, pra: 3 };
const r1 = (n: number) => Math.round(n * 10) / 10;

export type HoopsPropLine = {
  stat: HoopsStat;
  label: string;
  base: number;
  median: number;
  low: number;
  high: number;
  lines: Array<{ line: number; chance: number; hits: number; games: number }>;
};

export type HoopsPropPlayer = {
  id: string;
  name: string;
  pos: string | null;
  minutes: number;
  gamesThisSeason: number;
  injury: { status: string; note: string } | null;
  props: HoopsPropLine[];
};

export type HoopsPropSheet = {
  model: string;
  league: League;
  season: number;
  date: string | null;
  generatedAt: string;
  games: Array<{
    id: string;
    tipoff: string;
    away: string;
    home: string;
    sides: Array<{ team: string; opp: string; players: HoopsPropPlayer[]; out: Array<{ name: string; status: string; note: string }> }>;
  }>;
};

type Injury = { status: string; note: string };

/** ESPN injury report for a league, by ESPN athlete id (the same ids as the box scores). */
function injuries(league: League): Promise<Map<string, Injury>> {
  return cached(`${league}-injuries`, async () => {
    type J = { injuries?: Array<{ injuries?: Array<{ status: string; shortComment?: string; athlete: { links?: Array<{ href: string }> } }> }> };
    const json = (await fetch(`${LEAGUES[league].espn}/injuries`, { cache: 'no-store' }).then((r) => r.json())) as J;
    const out = new Map<string, Injury>();
    for (const t of json.injuries ?? []) {
      for (const i of t.injuries ?? []) {
        const id = i.athlete.links?.[0]?.href.match(/\/id\/(\d+)/)?.[1];
        if (id) out.set(id, { status: i.status, note: i.shortComment ?? '' });
      }
    }
    return out;
  });
}
const ruledOut = (s: string | undefined) => s === 'Out' || s === 'Doubtful' || s === 'Injured Reserve' || s === 'Suspension' || s === 'Suspended';

export async function getHoopsPropSheet(league: League): Promise<HoopsPropSheet> {
  const spread = spreadOf(league);
  const slate = await nextSlate(league);
  const cur = seasonFor(league);
  const latest = await latestSeason(league);
  // This season's games (none before opening night) and last season's, for the early-season blend.
  const [now, prev, injury] = await Promise.all([
    latest === cur ? playerGames(league, cur).catch(() => []) : Promise.resolve([] as HoopsPlayerGame[]),
    playerGames(league, cur - 1).catch(() => [] as HoopsPlayerGame[]),
    injuries(league).catch(() => new Map<string, Injury>()),
  ]);
  const byPlayer = (rows: HoopsPlayerGame[]) => {
    const m = new Map<string, HoopsPlayerGame[]>();
    for (const g of rows) m.set(g.playerId, [...(m.get(g.playerId) ?? []), g]);
    for (const l of m.values()) l.sort((a, b) => a.date.localeCompare(b.date));
    return m;
  };
  const nowBy = byPlayer(now);
  const prevBy = byPlayer(prev);

  const priorAvg = (id: string, f: (g: HoopsPlayerGame) => number) => {
    const gs = prevBy.get(id);
    return gs && gs.length >= 10 ? gs.reduce((a, g) => a + f(g), 0) / gs.length : null;
  };

  const side = async (team: string, espnTeamId: string, opp: string) => {
    const ids = await roster(league, espnTeamId).catch(() => new Set<string>());
    const out: Array<{ name: string; status: string; note: string }> = [];
    const players: HoopsPropPlayer[] = [];
    for (const id of ids) {
      const games = nowBy.get(id) ?? [];
      const last = games[games.length - 1] ?? prevBy.get(id)?.[prevBy.get(id)!.length - 1];
      if (!last) continue;
      const inj = injury.get(id) ?? null;
      const minutes = blendBaseline(games.map((g) => g.min), priorAvg(id, (g) => g.min), { ...spread.baseline, minGames: 1 });
      if (minutes == null || minutes < 12) continue;
      if (inj && ruledOut(inj.status)) {
        out.push({ name: last.name, status: inj.status, note: inj.note });
        continue;
      }
      const early = games.length < spread.earlyGames;
      const props: HoopsPropLine[] = [];
      for (const stat of HOOPS_STATS) {
        const base = blendBaseline(games.map((g) => hoopsStat(g, stat)), priorAvg(id, (g) => hoopsStat(g, stat)), spread.baseline);
        if (base == null || base < HOOPS_MIN_BASE[league][stat]) continue;
        const key = `${early ? 'early|' : ''}${stat}`;
        const median = outcomeAt(spread, key, base, 0.5) ?? base;
        const step = STEP[stat];
        const mid = Math.max(0.5, Math.round(median) - 0.5);
        // Hit rates over his last 10 (this season, topped up from last season).
        const recent = [...(prevBy.get(id) ?? []), ...games].slice(-10).map((g) => hoopsStat(g, stat));
        props.push({
          stat,
          label: HOOPS_STAT_LABEL[stat],
          base: r1(base),
          median: r1(median),
          low: r1(outcomeAt(spread, key, base, 0.25) ?? base),
          high: r1(outcomeAt(spread, key, base, 0.75) ?? base),
          lines: [mid - step, mid, mid + step]
            .filter((l) => l > 0)
            .map((line) => ({
              line,
              chance: Math.round(100 * (chanceOver(spread, key, base, line) ?? 0)),
              hits: recent.filter((v) => v > line).length,
              games: recent.length,
            })),
        });
      }
      if (props.length) players.push({ id, name: last.name, pos: last.pos, minutes: r1(minutes), gamesThisSeason: games.length, injury: inj && inj.status !== 'Active' ? inj : null, props });
    }
    players.sort((a, b) => b.minutes - a.minutes);
    return { team, opp, players: players.slice(0, 8), out };
  };

  const games = [];
  for (const g of slate?.games ?? []) {
    games.push({ id: g.id, tipoff: g.tipoff, away: g.away, home: g.home, sides: [await side(g.away, g.awayId, g.home), await side(g.home, g.homeId, g.away)] });
  }
  return { model: HOOPS_PROP_MODEL, league, season: cur, date: slate?.date ?? null, generatedAt: new Date().toISOString(), games };
}
