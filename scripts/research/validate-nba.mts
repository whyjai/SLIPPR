/**
 * Validate the NBA research numbers:
 *   - internal: games per team, player points add up to team points
 *   - independent provider: NBA.com team season stats (sportsdataverse mirror)
 *     for shooting/turnover totals, possessions, pace and ratings
 *   - the upcoming slate and roster join
 *
 *   npx tsx scripts/research/validate-nba.mts 2026
 *
 * Exits 1 if any check misses its tolerance.
 */
import { streamCsv } from '../../lib/research/csv';
import { NBA_TEAMS, nbaPlayerGames, nbaRoster, nbaTeamGames, nextNbaSlate, seasonFor } from '../../lib/research/nba-data';
import { teamStyles } from '../../lib/research/nba-teams';

const season = Number(process.argv[2] ?? seasonFor() - 1);
if (!Number.isInteger(season)) throw new Error('usage: validate-nba.mts <season>');

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}
const maxAbs = (xs: number[]) => Math.max(...xs.map(Math.abs));

const [players, teams] = await Promise.all([nbaPlayerGames(season), nbaTeamGames(season)]);
const games = new Map<string, number>();
for (const g of teams) games.set(g.team, (games.get(g.team) ?? 0) + 1);
const complete = season < seasonFor();
console.log(`${season}: ${teams.length / 2} games, ${players.length} player-games, ${complete ? 'complete' : 'in progress'}\n`);

// 1. Games per team (82; the two NBA Cup finalists play an 83rd that ESPN files as regular season).
{
  const counts = [...games.values()];
  const ok = games.size === 30 && (complete ? counts.every((n) => n === 82 || n === 83) && counts.filter((n) => n === 83).length <= 2 : counts.every((n) => n <= 83));
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
      `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/nba_stats_team_season_stats/team_season_stats_${season}.csv`,
      ['team_name', 'gp', 'season_type', 'measure_type', 'per_mode', 'pts', 'fga', 'fg3a', 'fta', 'oreb', 'tov', 'poss', 'pace', 'off_rating', 'def_rating'],
      (r) => {
        if (r.season_type !== 'regular-season' || r.per_mode !== 'totals') return;
        if (r.measure_type === 'base') base.set(r.team_name, r);
        if (r.measure_type === 'advanced') adv.set(r.team_name, r);
      },
    );
  } catch (e) {
    console.log(`SKIP  NBA.com team stats not published for ${season}: ${e instanceof Error ? e.message : e}`);
  }
  if (base.size) {
    const styles = teamStyles(teams);
    const d: Record<string, number[]> = { pts: [], fga: [], fg3a: [], fta: [], oreb: [], tov: [], poss: [], pace: [], ortg: [], drtg: [] };
    for (const [abbr, t] of Object.entries(NBA_TEAMS)) {
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
      check(`NBA.com ${k} per game`, n === 30 && maxAbs(d[k]) <= tol, `worst team diff ${maxAbs(d[k]).toFixed(2)}% over ${n} teams`);
    }
    check('NBA.com possessions per game', maxAbs(d.poss) <= 2, `worst ${maxAbs(d.poss).toFixed(2)}%, mean ${(d.poss.reduce((a, b) => a + b, 0) / n).toFixed(2)}%`);
    check('NBA.com pace', maxAbs(d.pace) <= 2, `worst ${maxAbs(d.pace).toFixed(2)} possessions per 48`);
    check('NBA.com offensive rating', maxAbs(d.ortg) <= 2, `worst ${maxAbs(d.ortg).toFixed(2)} pts per 100`);
    check('NBA.com defensive rating', maxAbs(d.drtg) <= 2, `worst ${maxAbs(d.drtg).toFixed(2)} pts per 100`);
  }
}

// 4. Upcoming slate and roster ids line up with box-score ids.
{
  const slate = await nextNbaSlate();
  if (!slate) {
    console.log('SKIP  No upcoming regular-season slate on ESPN');
  } else {
    const g = slate.games[0];
    const roster = await nbaRoster(g.homeId);
    const recent = await nbaPlayerGames(seasonFor() - 1).catch(() => []);
    const known = new Set([...players, ...recent].map((p) => p.playerId));
    const hit = [...roster].filter((id) => known.has(id)).length;
    check('Roster ids match box-score ids', roster.size > 0 && hit / roster.size >= 0.5, `${g.home}: ${hit}/${roster.size} rostered players found in box scores (rookies won't be)`);
    console.log(`      next slate ${slate.date}: ${slate.games.length} games`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
