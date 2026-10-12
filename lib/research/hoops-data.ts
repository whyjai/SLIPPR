/**
 * Basketball inputs (NBA and WNBA), all free: ESPN box scores via
 * sportsdataverse (hoopR / wehoop) releases, plus ESPN's public scoreboard and
 * rosters for the upcoming slate.
 *
 * `season` follows hoopR: the NBA labels a season by the year it ends
 * (2026 = 2025-26); the WNBA plays within one calendar year (2026 = 2026).
 */
import { cached, streamCsv } from './csv';

export type League = 'nba' | 'wnba';

const RELEASES = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download';

type LeagueConfig = {
  name: string;
  release: string; // sportsdataverse tag prefix
  espn: string;
  /** Regulation game length in minutes; each overtime adds 5. */
  regulation: number;
  /** Fixed team list (filters out All-Star rows), or null to take teams from the data (WNBA expansion). */
  teams: Record<string, { city: string; nickname: string }> | null;
  /** Current-season numbers are trusted once every team has this many games. */
  minGamesForCurrent: number;
  /** Regular-season games per team in a full season (the in-season cup final can add one). */
  seasonGames: number;
};

export const NBA_TEAMS: Record<string, { city: string; nickname: string }> = {
  ATL: { city: 'Atlanta', nickname: 'Hawks' },
  BKN: { city: 'Brooklyn', nickname: 'Nets' },
  BOS: { city: 'Boston', nickname: 'Celtics' },
  CHA: { city: 'Charlotte', nickname: 'Hornets' },
  CHI: { city: 'Chicago', nickname: 'Bulls' },
  CLE: { city: 'Cleveland', nickname: 'Cavaliers' },
  DAL: { city: 'Dallas', nickname: 'Mavericks' },
  DEN: { city: 'Denver', nickname: 'Nuggets' },
  DET: { city: 'Detroit', nickname: 'Pistons' },
  GS: { city: 'Golden State', nickname: 'Warriors' },
  HOU: { city: 'Houston', nickname: 'Rockets' },
  IND: { city: 'Indiana', nickname: 'Pacers' },
  LAC: { city: 'LA', nickname: 'Clippers' },
  LAL: { city: 'Los Angeles', nickname: 'Lakers' },
  MEM: { city: 'Memphis', nickname: 'Grizzlies' },
  MIA: { city: 'Miami', nickname: 'Heat' },
  MIL: { city: 'Milwaukee', nickname: 'Bucks' },
  MIN: { city: 'Minnesota', nickname: 'Timberwolves' },
  NO: { city: 'New Orleans', nickname: 'Pelicans' },
  NY: { city: 'New York', nickname: 'Knicks' },
  OKC: { city: 'Oklahoma City', nickname: 'Thunder' },
  ORL: { city: 'Orlando', nickname: 'Magic' },
  PHI: { city: 'Philadelphia', nickname: '76ers' },
  PHX: { city: 'Phoenix', nickname: 'Suns' },
  POR: { city: 'Portland', nickname: 'Trail Blazers' },
  SA: { city: 'San Antonio', nickname: 'Spurs' },
  SAC: { city: 'Sacramento', nickname: 'Kings' },
  TOR: { city: 'Toronto', nickname: 'Raptors' },
  UTAH: { city: 'Utah', nickname: 'Jazz' },
  WSH: { city: 'Washington', nickname: 'Wizards' },
};

export const LEAGUES: Record<League, LeagueConfig> = {
  nba: {
    name: 'NBA',
    release: 'espn_nba',
    espn: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba',
    regulation: 48,
    teams: NBA_TEAMS,
    minGamesForCurrent: 15,
    seasonGames: 82,
  },
  wnba: {
    name: 'WNBA',
    release: 'espn_wnba',
    espn: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba',
    regulation: 40,
    teams: null,
    minGamesForCurrent: 8,
    seasonGames: 44,
  },
};

export const isLeague = (x: string): x is League => x === 'nba' || x === 'wnba';

export type HoopsPos = 'G' | 'F' | 'C';
const POS: Record<string, HoopsPos> = { G: 'G', PG: 'G', SG: 'G', F: 'F', SF: 'F', PF: 'F', C: 'C' };

export type HoopsPlayerGame = {
  gameId: string;
  season: number;
  date: string; // YYYY-MM-DD
  playerId: string;
  name: string;
  pos: HoopsPos | null;
  team: string;
  teamId: string;
  opp: string;
  home: boolean;
  starter: boolean;
  min: number;
  pts: number;
  reb: number;
  oreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
};

export type HoopsTeamGame = {
  gameId: string;
  season: number;
  date: string;
  team: string;
  opp: string;
  home: boolean;
  pts: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  tov: number;
  paint: number;
  fastBreak: number;
  /** Possessions (both teams' Basketball-Reference estimates, averaged). */
  poss: number;
  /** Game length in minutes (48 or 40, +5 per OT), from player minutes. */
  minutes: number;
};

export const seasonLabel = (league: League, season: number) =>
  league === 'nba' ? `${season - 1}-${String(season).slice(2)}` : `${season}`;

/**
 * The season label that is current (or next up) on this date. NBA: Sep-Dec
 * belong to the next year's label. WNBA: the calendar year.
 */
export const seasonFor = (league: League, d = new Date()) =>
  league === 'nba' && d.getUTCMonth() >= 8 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();

const num = (s: string | undefined) => (s === undefined || s === '' || s === 'NA' ? 0 : Number(s) || 0);
const yes = (s: string | undefined) => s?.toLowerCase() === 'true'; // files mix "true" and "TRUE"
const REGULAR = '2';

const PLAYER_COLS = [
  'game_id', 'season', 'season_type', 'game_date', 'athlete_id', 'athlete_display_name', 'athlete_position_abbreviation',
  'team_id', 'team_abbreviation', 'opponent_team_abbreviation', 'home_away', 'starter', 'did_not_play', 'minutes', 'points',
  'rebounds', 'offensive_rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'field_goals_made', 'field_goals_attempted',
  'three_point_field_goals_made', 'three_point_field_goals_attempted', 'free_throws_made', 'free_throws_attempted',
];

/**
 * Keep league teams only. With a fixed list (NBA) that drops All-Star rows; for
 * the WNBA, All-Star "teams" play once, so drop teams with a sliver of the games.
 */
function leagueTeams(league: League, counts: Map<string, number>): Set<string> {
  const fixed = LEAGUES[league].teams;
  if (fixed) return new Set(Object.keys(fixed));
  const max = Math.max(0, ...counts.values());
  return new Set([...counts].filter(([, n]) => n >= Math.min(5, Math.ceil(max / 2))).map(([t]) => t));
}

/** Regular-season player games (played minutes only), league teams only. */
export function playerGames(league: League, season: number): Promise<HoopsPlayerGame[]> {
  return cached(`${league}-players-${season}`, async () => {
    const out: HoopsPlayerGame[] = [];
    await streamCsv(`${RELEASES}/${LEAGUES[league].release}_player_boxscores/player_box_${season}.csv`, PLAYER_COLS, (r) => {
      if (r.season_type !== REGULAR || yes(r.did_not_play)) return;
      const min = num(r.minutes);
      if (min <= 0) return;
      out.push({
        gameId: r.game_id,
        season,
        date: r.game_date,
        playerId: r.athlete_id,
        name: r.athlete_display_name,
        pos: POS[r.athlete_position_abbreviation] ?? null,
        team: r.team_abbreviation,
        teamId: r.team_id,
        opp: r.opponent_team_abbreviation,
        home: r.home_away === 'home',
        starter: yes(r.starter),
        min,
        pts: num(r.points),
        reb: num(r.rebounds),
        oreb: num(r.offensive_rebounds),
        ast: num(r.assists),
        stl: num(r.steals),
        blk: num(r.blocks),
        tov: num(r.turnovers),
        fgm: num(r.field_goals_made),
        fga: num(r.field_goals_attempted),
        fg3m: num(r.three_point_field_goals_made),
        fg3a: num(r.three_point_field_goals_attempted),
        ftm: num(r.free_throws_made),
        fta: num(r.free_throws_attempted),
      });
    });
    const teams = await teamNames(league, season);
    return out.filter((p) => teams[p.team] && teams[p.opp]);
  });
}

const TEAM_COLS = [
  'game_id', 'season_type', 'game_date', 'team_abbreviation', 'team_location', 'team_name', 'opponent_team_abbreviation',
  'team_home_away', 'team_score',
  'field_goals_made', 'field_goals_attempted', 'three_point_field_goals_made', 'three_point_field_goals_attempted',
  'free_throws_made', 'free_throws_attempted', 'offensive_rebounds', 'defensive_rebounds', 'assists', 'total_turnovers',
  'points_in_paint', 'fast_break_points',
];

type TeamRow = Omit<HoopsTeamGame, 'poss' | 'minutes'> & { city: string; nickname: string };

/** Raw regular-season team rows (all teams, All-Star included), cached for both readers below. */
function teamRows(league: League, season: number): Promise<TeamRow[]> {
  return cached(`${league}-teamrows-${season}`, async () => {
    const rows: TeamRow[] = [];
    await streamCsv(`${RELEASES}/${LEAGUES[league].release}_team_boxscores/team_box_${season}.csv`, TEAM_COLS, (r) => {
      if (r.season_type !== REGULAR) return;
      rows.push({
        gameId: r.game_id,
        season,
        date: r.game_date,
        team: r.team_abbreviation,
        city: r.team_location,
        nickname: r.team_name,
        opp: r.opponent_team_abbreviation,
        home: r.team_home_away === 'home',
        pts: num(r.team_score),
        fgm: num(r.field_goals_made),
        fga: num(r.field_goals_attempted),
        fg3m: num(r.three_point_field_goals_made),
        fg3a: num(r.three_point_field_goals_attempted),
        ftm: num(r.free_throws_made),
        fta: num(r.free_throws_attempted),
        oreb: num(r.offensive_rebounds),
        dreb: num(r.defensive_rebounds),
        ast: num(r.assists),
        tov: num(r.total_turnovers),
        paint: num(r.points_in_paint),
        fastBreak: num(r.fast_break_points),
      });
    });
    return rows;
  });
}

/** The league's teams this season: abbreviation → city and nickname. */
export async function teamNames(league: League, season: number): Promise<Record<string, { city: string; nickname: string }>> {
  const fixed = LEAGUES[league].teams;
  if (fixed) return fixed;
  const rows = await teamRows(league, season);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.team, (counts.get(r.team) ?? 0) + 1);
  const keep = leagueTeams(league, counts);
  const out: Record<string, { city: string; nickname: string }> = {};
  for (const r of rows) if (keep.has(r.team)) out[r.team] = { city: r.city, nickname: r.nickname };
  return out;
}

/** Regular-season team games with possessions and game length. */
export function teamGames(league: League, season: number): Promise<HoopsTeamGame[]> {
  return cached(`${league}-teams-${season}`, async () => {
    const [players, raw, names] = await Promise.all([playerGames(league, season), teamRows(league, season), teamNames(league, season)]);
    const minutes = new Map<string, number>();
    for (const p of players) minutes.set(`${p.gameId}|${p.team}`, (minutes.get(`${p.gameId}|${p.team}`) ?? 0) + p.min);
    const rows = raw.filter((r) => names[r.team] && names[r.opp]);

    // Basketball-Reference possessions (offensive-rebound share discounts misses). Matches
    // NBA.com's play-by-play possession counts within ~1% per team-season (validate-hoops.mts).
    const side = (t: TeamRow, o: TeamRow) => {
      const orbShare = t.oreb + o.dreb ? t.oreb / (t.oreb + o.dreb) : 0;
      return t.fga + 0.4 * t.fta - 1.07 * orbShare * (t.fga - t.fgm) + t.tov;
    };
    const reg = LEAGUES[league].regulation;
    const byKey = new Map(rows.map((t) => [`${t.gameId}|${t.team}`, t]));
    return rows
      .filter((t) => byKey.has(`${t.gameId}|${t.opp}`))
      .map((row) => {
        const o = byKey.get(`${row.gameId}|${row.opp}`)!;
        const played = (minutes.get(`${row.gameId}|${row.team}`) ?? reg * 5) / 5;
        // Each overtime adds 5. Player minutes are rounded, so snap to that grid.
        const length = Math.max(reg, reg + Math.round((played - reg) / 5) * 5);
        return { ...row, poss: (side(row, o) + side(o, row)) / 2, minutes: length };
      });
  });
}

/** Latest season with box scores published: the current label if its file exists, else the one before. */
export function latestSeason(league: League): Promise<number> {
  return cached(`${league}-latest`, async () => {
    const cur = seasonFor(league);
    const res = await fetch(`${RELEASES}/${LEAGUES[league].release}_player_boxscores/player_box_${cur}.csv`, { method: 'HEAD', cache: 'no-store' });
    return res.ok ? cur : cur - 1;
  });
}

// ---------------------------------------------------------------------------
// Upcoming slate (ESPN scoreboard) and current rosters
// ---------------------------------------------------------------------------

export type UpcomingGame = {
  id: string;
  tipoff: string; // ISO
  home: string;
  away: string;
  homeId: string;
  awayId: string;
};

type EspnEvent = {
  id: string;
  date: string;
  season?: { type?: number };
  competitions: Array<{ status?: { type?: { state?: string } }; competitors: Array<{ homeAway: string; team: { id: string; abbreviation: string } }> }>;
};

/** The next day with regular-season or playoff games that haven't started (scans ESPN's calendar). */
export function nextSlate(league: League): Promise<{ date: string; postseason: boolean; games: UpcomingGame[] } | null> {
  return cached(`${league}-slate`, async () => {
    const espn = LEAGUES[league].espn;
    const board = await fetch(`${espn}/scoreboard`, { cache: 'no-store' }).then((r) => r.json());
    const calendar: string[] = board?.leagues?.[0]?.calendar ?? [];
    // Calendar entries are midnight Pacific in UTC ("2026-10-20T07:00Z"); the date part is the US game day.
    const today = new Date(Date.now() - 8 * 3600_000).toISOString().slice(0, 10);
    const days = calendar.map((d) => (typeof d === 'string' ? d : '').slice(0, 10)).filter((d) => d >= today).slice(0, 40);
    for (const day of days) {
      const json = await fetch(`${espn}/scoreboard?dates=${day.replaceAll('-', '')}`, { cache: 'no-store' }).then((r) => r.json());
      const events = ((json?.events ?? []) as EspnEvent[]).filter(
        (e) => (e.season?.type === 2 || e.season?.type === 3) && e.competitions[0]?.status?.type?.state === 'pre',
      );
      const games: UpcomingGame[] = events.map((e) => {
        const c = e.competitions[0].competitors;
        const home = c.find((x) => x.homeAway === 'home')!.team;
        const away = c.find((x) => x.homeAway === 'away')!.team;
        return { id: e.id, tipoff: e.date, home: home.abbreviation, away: away.abbreviation, homeId: home.id, awayId: away.id };
      });
      if (games.length) return { date: day, postseason: events.every((e) => e.season?.type === 3), games };
    }
    return null;
  });
}

/** ESPN athlete ids on a team's current roster (same ids as the box scores). */
export function roster(league: League, espnTeamId: string): Promise<Set<string>> {
  return cached(`${league}-roster-${espnTeamId}`, async () => {
    const json = await fetch(`${LEAGUES[league].espn}/teams/${espnTeamId}/roster`, { cache: 'no-store' }).then((r) => r.json());
    const athletes: Array<{ id: string }> = json?.athletes ?? [];
    return new Set(athletes.map((a) => a.id));
  });
}
