/**
 * Basketball player trends: minutes and production per game this season, the last
 * 5 and 10 games, last season for comparison, usage rate, and a 10-game log
 * (hit rates are computed from it in the UI). Box scores only.
 */
import { playerGames, seasonLabel, teamGames, type HoopsPlayerGame, type HoopsPos, type League } from './hoops-data';

export type HoopsGameLogEntry = {
  date: string;
  team: string;
  opp: string;
  home: boolean;
  starter: boolean;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
  pra: number;
  fgm: number;
  fga: number;
};

export type HoopsAverages = {
  games: number;
  starts: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
  pra: number;
  stl: number;
  blk: number;
  tov: number;
  fga: number;
  /** Share of team plays he used while on the floor, % (Basketball-Reference formula). */
  usage: number | null;
};

export type HoopsPlayerTrend = {
  id: string;
  name: string;
  pos: HoopsPos | null;
  team: string;
  season: HoopsAverages;
  last5: HoopsAverages;
  last10: HoopsAverages;
  prior: HoopsAverages | null; // last season, 10+ games
  log: HoopsGameLogEntry[]; // newest first, up to 10
};

export type HoopsUsageChange = {
  id: string;
  name: string;
  pos: HoopsPos | null;
  team: string;
  metric: 'Minutes' | 'Usage %';
  now: number;
  before: number;
  delta: number;
};

export type HoopsPlayerTrends = {
  sport: League;
  season: number;
  seasonLabel: string;
  generatedAt: string;
  players: HoopsPlayerTrend[];
  risers: HoopsUsageChange[];
  fallers: HoopsUsageChange[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const LOG_GAMES = 10;

type TeamTotals = { fga: number; fta: number; tov: number; minutes: number };

function averages(rows: HoopsPlayerGame[], team: Map<string, TeamTotals>): HoopsAverages {
  const n = rows.length || 1;
  const sum = (f: (r: HoopsPlayerGame) => number) => rows.reduce((s, r) => s + f(r), 0);
  const avg = (f: (r: HoopsPlayerGame) => number) => r1(sum(f) / n);
  // Usage: 100 × (FGA + 0.44·FTA + TOV) × (team minutes / 5) / (minutes × team (FGA + 0.44·FTA + TOV)), over his games.
  let tm = 0, tmMin = 0;
  for (const r of rows) {
    const t = team.get(`${r.gameId}|${r.team}`);
    if (!t) continue;
    tm += t.fga + 0.44 * t.fta + t.tov;
    tmMin += t.minutes;
  }
  const mine = sum((r) => r.fga + 0.44 * r.fta + r.tov);
  const min = sum((r) => r.min);
  return {
    games: rows.length,
    starts: rows.filter((r) => r.starter).length,
    min: avg((r) => r.min),
    pts: avg((r) => r.pts),
    reb: avg((r) => r.reb),
    ast: avg((r) => r.ast),
    fg3m: avg((r) => r.fg3m),
    pra: avg((r) => r.pts + r.reb + r.ast),
    stl: avg((r) => r.stl),
    blk: avg((r) => r.blk),
    tov: avg((r) => r.tov),
    fga: avg((r) => r.fga),
    usage: tm && min ? r1((100 * mine * (tmMin / 5)) / (min * tm)) : null,
  };
}

async function teamTotals(league: League, season: number): Promise<Map<string, TeamTotals>> {
  const games = await teamGames(league, season).catch(() => []);
  return new Map(games.map((g) => [`${g.gameId}|${g.team}`, { fga: g.fga, fta: g.fta, tov: g.tov, minutes: g.minutes * 5 }]));
}

export async function getHoopsPlayerTrends(league: League, season: number): Promise<HoopsPlayerTrends> {
  const [cur, prev, curTeams, prevTeams] = await Promise.all([
    playerGames(league, season),
    playerGames(league, season - 1).catch(() => [] as HoopsPlayerGame[]),
    teamTotals(league, season),
    teamTotals(league, season - 1),
  ]);
  const group = (rows: HoopsPlayerGame[]) => {
    const m = new Map<string, HoopsPlayerGame[]>();
    for (const r of rows) m.set(r.playerId, [...(m.get(r.playerId) ?? []), r]);
    for (const list of m.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return m;
  };
  const curBy = group(cur);
  const prevBy = group(prev);

  const players: HoopsPlayerTrend[] = [];
  for (const [id, rows] of curBy) {
    const season = averages(rows, curTeams);
    if (rows.length < 5 || season.min < 10) continue;
    const before = prevBy.get(id) ?? [];
    const last = rows[rows.length - 1];
    players.push({
      id,
      name: last.name,
      pos: last.pos,
      team: last.team,
      season,
      last5: averages(rows.slice(-5), curTeams),
      last10: averages(rows.slice(-10), curTeams),
      prior: before.length >= 10 ? averages(before, prevTeams) : null,
      log: rows
        .slice(-LOG_GAMES)
        .reverse()
        .map((r) => ({
          date: r.date,
          team: r.team,
          opp: r.opp,
          home: r.home,
          starter: r.starter,
          min: r.min,
          pts: r.pts,
          reb: r.reb,
          ast: r.ast,
          fg3m: r.fg3m,
          pra: r.pts + r.reb + r.ast,
          fgm: r.fgm,
          fga: r.fga,
        })),
    });
  }
  players.sort((a, b) => b.season.pra - a.season.pra);

  // Role changes vs last season: minutes and usage, 10+ games in both.
  const changes: HoopsUsageChange[] = [];
  for (const p of players) {
    if (!p.prior || p.season.games < 10) continue;
    const add = (metric: HoopsUsageChange['metric'], now: number | null, before: number | null, min: number) => {
      if (now == null || before == null) return;
      const delta = r1(now - before);
      if (Math.abs(delta) >= min) changes.push({ id: p.id, name: p.name, pos: p.pos, team: p.team, metric, now, before, delta });
    };
    add('Minutes', p.season.min, p.prior.min, 5);
    add('Usage %', p.season.usage, p.prior.usage, 4);
  }
  const best = new Map<string, HoopsUsageChange>();
  for (const c of changes) {
    const cur = best.get(c.id);
    if (!cur || Math.abs(c.delta) > Math.abs(cur.delta)) best.set(c.id, c);
  }
  const ranked = [...best.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    sport: league,
    season,
    seasonLabel: seasonLabel(league, season),
    generatedAt: new Date().toISOString(),
    players,
    risers: ranked.filter((c) => c.delta > 0).slice(0, 8),
    fallers: ranked.filter((c) => c.delta < 0).slice(0, 8),
  };
}
