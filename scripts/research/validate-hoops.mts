/**
 * Validate the basketball research numbers (NBA or WNBA):
 *   - internal: games per team, player points add up to team points
 *   - independent provider: NBA.com / WNBA.com team season stats (sportsdataverse
 *     mirror; skipped when a season isn't published there)
 *     for shooting/turnover totals, possessions, pace and ratings
 *   - the upcoming slate and roster join
 *
 *   npx tsx scripts/research/validate-hoops.mts nba 2026
 *   npx tsx scripts/research/validate-hoops.mts wnba 2026
 *
 * Exits 1 if any check misses its tolerance.
 */
import { streamCsv } from '../../lib/research/csv';
import { LEAGUES, isLeague, nextSlate, playerGames, roster, seasonFor, teamGames, teamNames } from '../../lib/research/hoops-data';
import { teamStyles } from '../../lib/research/hoops-teams';

const league = process.argv[2] ?? 'nba';
const season = Number(process.argv[3] ?? (isLeague(league) ? seasonFor(league) - 1 : NaN));
if (!isLeague(league) || !Number.isInteger(season)) throw new Error('usage: validate-hoops.mts <nba|wnba> <season>');
const cfg = LEAGUES[league];

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}
const maxAbs = (xs: number[]) => Math.max(...xs.map(Math.abs));

const [players, teams, names] = await Promise.all([playerGames(league, season), teamGames(league, season), teamNames(league, season)]);
const games = new Map<string, number>();
for (const g of teams) games.set(g.team, (games.get(g.team) ?? 0) + 1);
// A season is complete once a later one is under way or its own calendar has passed.
const complete = season < seasonFor(league) || (league === 'wnba' && new Date().getUTCMonth() >= 9);
console.log(`${cfg.name} ${season}: ${teams.length / 2} games, ${players.length} player-games, ${complete ? 'complete' : 'in progress'}\n`);

// 1. Games per team (82 NBA / 44 WNBA; the in-season cup final adds one that ESPN files as regular season).
{
  const counts = [...games.values()];
  const full = cfg.seasonGames;
  const nTeams = Object.keys(names).length;
  const ok =
    games.size === nTeams &&
    (complete ? counts.every((n) => n === full || n === full + 1) && counts.filter((n) => n === full + 1).length <= 2 : counts.every((n) => n <= full + 1));
  check('Games per team', ok, `${games.size} teams, ${Math.min(...counts)}-${Math.max(...counts)} games`);
}

// 2. Player points add up to team points.
{
  const sum = new Map<string, number>();
  for (const p of players) sum.set(`${p.gameId}|${p.team}`, (sum.get(`${p.gameId}|${p.team}`) ?? 0) + p.pts);
  const bad = teams.filter((g) => (sum.get(`${g.gameId}|${g.team}`) ?? 0) !== g.pts);
  const share = bad.length / teams.length;
  check('Player points = team points', share <= 0.01, `${teams.length - bad.length}/${teams.length} team-games (${(100 * share).toFixed(2)}% with missing player rows)`);
}

// 3. NBA.com team season stats: totals, possessions, pace, ratings.
{
  type Row = Record<string, string>;
  const base = new Map<string, Row>();
  const adv = new Map<string, Row>();
  try {
    await streamCsv(
      `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/${league}_stats_team_season_stats/team_season_stats_${season}.csv`,
      ['team_name', 'gp', 'season_type', 'measure_type', 'per_mode', 'pts', 'fga', 'fg3a', 'fta', 'oreb', 'tov', 'poss', 'pace', 'off_rating', 'def_rating'],
      (r) => {
        if (r.season_type !== 'regular-season' || r.per_mode !== 'totals') return;
        if (r.measure_type === 'base') base.set(r.team_name, r);
        if (r.measure_type === 'advanced') adv.set(r.team_name, r);
      },
    );
  } catch (e) {
    console.log(`SKIP  ${cfg.name}.com team stats not published for ${season}: ${e instanceof Error ? e.message : e}`);
  }
  if (base.size) {
    const styles = teamStyles(teams, cfg.regulation);
    const d: Record<string, number[]> = { pts: [], fga: [], fg3a: [], fta: [], oreb: [], tov: [], poss: [], pace: [], ortg: [], drtg: [] };
    for (const [abbr, t] of Object.entries(names)) {
      const name = `${t.city} ${t.nickname}`;
      const b = base.get(name), a = adv.get(name);
      const mine = teams.filter((g) => g.team === abbr);
      if (!b || !a || !mine.length) continue;
      const per = (k: keyof (typeof mine)[number]) => mine.reduce((s, g) => s + (g[k] as number), 0) / mine.length;
      const nba = (r: Row, k: string) => Number(r[k]) / Number(b.gp);
      for (const k of ['pts', 'fga', 'fg3a', 'fta', 'oreb', 'tov'] as const) d[k].push(100 * (per(k) / nba(b, k) - 1));
      d.poss.push(100 * (per('poss') / nba(a, 'poss') - 1));
      d.pace.push(styles[abbr].pace - Number(a.pace));
      d.ortg.push(styles[abbr].ortg - Number(a.off_rating));
      d.drtg.push(styles[abbr].drtg - Number(a.def_rating));
    }
    const n = d.pts.length;
    for (const k of ['pts', 'fga', 'fg3a', 'fta', 'oreb', 'tov'] as const) {
      // Turnovers: ESPN and NBA.com assign team turnovers (shot clock, 8-second) differently per team;
      // league totals agree within ~0.1%, single teams within ~3%.
      const tol = k === 'tov' ? 3 : 1;
      check(`${cfg.name}.com ${k} per game`, n === Object.keys(names).length && maxAbs(d[k]) <= tol, `worst team diff ${maxAbs(d[k]).toFixed(2)}% over ${n} teams`);
    }
    check(`${cfg.name}.com possessions per game`, maxAbs(d.poss) <= 2, `worst ${maxAbs(d.poss).toFixed(2)}%, mean ${(d.poss.reduce((a, b) => a + b, 0) / n).toFixed(2)}%`);
    check(`${cfg.name}.com pace`, maxAbs(d.pace) <= 2, `worst ${maxAbs(d.pace).toFixed(2)} possessions per 48`);
    check(`${cfg.name}.com offensive rating`, maxAbs(d.ortg) <= 2, `worst ${maxAbs(d.ortg).toFixed(2)} pts per 100`);
    check(`${cfg.name}.com defensive rating`, maxAbs(d.drtg) <= 2, `worst ${maxAbs(d.drtg).toFixed(2)} pts per 100`);
  }
}

// 4. Upcoming slate and roster ids line up with box-score ids.
{
  const slate = await nextSlate(league);
  if (!slate) {
    console.log('SKIP  No upcoming regular-season slate on ESPN');
  } else {
    const g = slate.games[0];
    const current = await roster(league, g.homeId);
    const recent = await playerGames(league, seasonFor(league) - 1).catch(() => []);
    const known = new Set([...players, ...recent].map((p) => p.playerId));
    const hit = [...current].filter((id) => known.has(id)).length;
    check('Roster ids match box-score ids', current.size > 0 && hit / current.size >= 0.5, `${g.home}: ${hit}/${current.size} rostered players found in box scores (rookies won't be)`);
    console.log(`      next slate ${slate.date}: ${slate.games.length} games`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
