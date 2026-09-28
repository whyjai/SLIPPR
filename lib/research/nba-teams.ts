/**
 * NBA team tendencies from box scores: pace, efficiency and shot profile on
 * both ends. `teamStyles` is also what the matchup projections read.
 */
import { NBA_TEAMS, nbaTeamGames, seasonLabel, type NbaTeamGame } from './nba-data';
import { rank, type NflTeamTendencies, type TendencyMetric } from './nfl-teams';

export type TeamStyle = {
  team: string;
  games: number;
  pace: number; // possessions per 48 minutes
  ortg: number; // points per 100 possessions
  drtg: number; // points allowed per 100 possessions
  efg: number; // %
  oppEfg: number;
  threeRate: number; // % of FGA that are threes
  oppThreeRate: number;
  ftRate: number; // FTA per 100 FGA
  oppFtRate: number;
  orebPct: number; // % of own misses rebounded
  oppOrebPct: number;
  tovPct: number; // turnovers per 100 possessions
  forcedTovPct: number;
  paint: number; // paint points per game
  oppPaint: number;
  fastBreak: number;
  oppFastBreak: number;
  astRate: number; // % of made FGs assisted
};

/** Season (or any subset of games) → one style line per team. */
export function teamStyles(games: NbaTeamGame[]): Record<string, TeamStyle> {
  const byKey = new Map(games.map((g) => [`${g.gameId}|${g.team}`, g]));
  const acc = new Map<string, Record<string, number>>();
  for (const g of games) {
    const o = byKey.get(`${g.gameId}|${g.opp}`);
    if (!o) continue;
    const a = acc.get(g.team) ?? {};
    const add = (k: string, v: number) => (a[k] = (a[k] ?? 0) + v);
    add('n', 1);
    add('poss', g.poss);
    add('pace', (g.poss * 48) / g.minutes);
    add('pts', g.pts);
    add('oppPts', o.pts);
    for (const [k, v] of Object.entries({ fgm: g.fgm, fga: g.fga, fg3m: g.fg3m, fg3a: g.fg3a, fta: g.fta, oreb: g.oreb, dreb: g.dreb, ast: g.ast, tov: g.tov, paint: g.paint, fb: g.fastBreak })) {
      add(k, v);
    }
    for (const [k, v] of Object.entries({ fgm: o.fgm, fga: o.fga, fg3m: o.fg3m, fg3a: o.fg3a, fta: o.fta, oreb: o.oreb, dreb: o.dreb, tov: o.tov, paint: o.paint, fb: o.fastBreak })) {
      add(`o_${k}`, v);
    }
    acc.set(g.team, a);
  }
  const out: Record<string, TeamStyle> = {};
  for (const [team, a] of acc) {
    const pct = (x: number, y: number) => (y ? (100 * x) / y : 0);
    out[team] = {
      team,
      games: a.n,
      pace: a.pace / a.n,
      ortg: pct(a.pts, a.poss),
      drtg: pct(a.oppPts, a.poss),
      efg: pct(a.fgm + 0.5 * a.fg3m, a.fga),
      oppEfg: pct(a.o_fgm + 0.5 * a.o_fg3m, a.o_fga),
      threeRate: pct(a.fg3a, a.fga),
      oppThreeRate: pct(a.o_fg3a, a.o_fga),
      ftRate: pct(a.fta, a.fga),
      oppFtRate: pct(a.o_fta, a.o_fga),
      orebPct: pct(a.oreb, a.oreb + a.o_dreb),
      oppOrebPct: pct(a.o_oreb, a.o_oreb + a.dreb),
      tovPct: pct(a.tov, a.poss),
      forcedTovPct: pct(a.o_tov, a.poss),
      paint: a.paint / a.n,
      oppPaint: a.o_paint / a.n,
      fastBreak: a.fb / a.n,
      oppFastBreak: a.o_fb / a.n,
      astRate: pct(a.ast, a.fgm),
    };
  }
  return out;
}

export const NBA_OFFENSE_METRICS: TendencyMetric[] = [
  { key: 'pace', label: 'Pace', unit: '', highIsFirst: true, hint: 'Possessions per 48 minutes. #1 = fastest.' },
  { key: 'ortg', label: 'Offensive rating', unit: '', highIsFirst: true, hint: 'Points scored per 100 possessions.' },
  { key: 'efg', label: 'eFG%', unit: '%', highIsFirst: true, hint: 'Effective field-goal %: a three counts 1.5 makes.' },
  { key: 'threeRate', label: '3PA rate', unit: '%', highIsFirst: true, hint: 'Share of shots taken from three.' },
  { key: 'ftRate', label: 'FT rate', unit: '', highIsFirst: true, hint: 'Free-throw attempts per 100 field-goal attempts.' },
  { key: 'orebPct', label: 'Off. rebound %', unit: '%', highIsFirst: true, hint: 'Share of their own misses they rebound.' },
  { key: 'tovPct', label: 'Turnover %', unit: '', highIsFirst: true, hint: 'Turnovers per 100 possessions. #1 = most careless.' },
  { key: 'paint', label: 'Paint points', unit: '', highIsFirst: true, hint: 'Points in the paint per game.' },
  { key: 'fastBreak', label: 'Fast-break points', unit: '', highIsFirst: true, hint: 'Fast-break points per game.' },
  { key: 'astRate', label: 'Assist rate', unit: '%', highIsFirst: true, hint: 'Share of made field goals that were assisted.' },
];

export const NBA_DEFENSE_METRICS: TendencyMetric[] = [
  { key: 'drtg', label: 'Defensive rating', unit: '', highIsFirst: true, hint: 'Points allowed per 100 possessions. #1 = allows the most.' },
  { key: 'oppEfg', label: 'Opp. eFG%', unit: '%', highIsFirst: true, hint: 'Opponent effective field-goal %. #1 = allows the best shooting.' },
  { key: 'oppThreeRate', label: 'Opp. 3PA rate', unit: '%', highIsFirst: true, hint: 'Share of opponent shots from three. #1 = gives up the most threes.' },
  { key: 'oppFtRate', label: 'Opp. FT rate', unit: '', highIsFirst: true, hint: 'Opponent free-throw attempts per 100 field-goal attempts. #1 = fouls the most.' },
  { key: 'oppOrebPct', label: 'Opp. off. rebound %', unit: '%', highIsFirst: true, hint: 'Share of opponent misses the opponent rebounds. #1 = weakest on the glass.' },
  { key: 'forcedTovPct', label: 'Forced turnovers', unit: '', highIsFirst: false, hint: 'Opponent turnovers per 100 possessions. #1 = forces the fewest.' },
  { key: 'oppPaint', label: 'Opp. paint points', unit: '', highIsFirst: true, hint: 'Paint points allowed per game. #1 = allows the most.' },
  { key: 'oppFastBreak', label: 'Opp. fast-break points', unit: '', highIsFirst: true, hint: 'Fast-break points allowed per game. #1 = allows the most.' },
];

export type NbaTeamTendencies = NflTeamTendencies & { sport: 'nba'; seasonLabel: string; gamesPlayed: number };

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function getNbaTeamTendencies(season: number): Promise<NbaTeamTendencies> {
  const styles = teamStyles(await nbaTeamGames(season));
  const rows = Object.values(styles).filter((s) => NBA_TEAMS[s.team]);
  const values = (keys: TendencyMetric[]) => (s: TeamStyle) =>
    Object.fromEntries(keys.map((m) => [m.key, r1(s[m.key as keyof TeamStyle] as number)])) as Record<string, number | null>;
  const off = rank(rows.map((s) => ({ team: s.team, values: values(NBA_OFFENSE_METRICS)(s) })), NBA_OFFENSE_METRICS);
  const def = rank(rows.map((s) => ({ team: s.team, values: values(NBA_DEFENSE_METRICS)(s) })), NBA_DEFENSE_METRICS);
  const gamesPlayed = Math.max(0, ...rows.map((s) => s.games));
  return {
    sport: 'nba',
    season,
    seasonLabel: seasonLabel(season),
    gamesPlayed,
    throughWeek: gamesPlayed,
    chartedThroughWeek: gamesPlayed,
    chartedPartialGames: 0,
    hasCharting: false,
    coverageSeason: null,
    offenseMetrics: NBA_OFFENSE_METRICS,
    defenseMetrics: NBA_DEFENSE_METRICS,
    teams: rows
      .map((s) => ({
        team: s.team,
        name: `${NBA_TEAMS[s.team].city} ${NBA_TEAMS[s.team].nickname}`,
        games: s.games,
        offense: off.cells[s.team],
        defense: def.cells[s.team],
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    leagueAvg: { offense: off.avg, defense: def.avg },
  };
}
