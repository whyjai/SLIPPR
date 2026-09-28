/**
 * NBA inputs, all free: ESPN box scores via sportsdataverse (hoopR) releases,
 * plus ESPN's public scoreboard and rosters for the upcoming slate.
 *
 * `season` is the year a season ends, as hoopR labels it: 2026 = 2025-26.
 */
import { cached, streamCsv } from './csv';

const RELEASES = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

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
export const nbaNickname = (abbr: string) => NBA_TEAMS[abbr]?.nickname ?? abbr;

export type NbaPos = 'G' | 'F' | 'C';
const POS: Record<string, NbaPos> = { G: 'G', PG: 'G', SG: 'G', F: 'F', SF: 'F', PF: 'F', C: 'C' };

export type NbaPlayerGame = {
  gameId: string;
  season: number;
  date: string; // YYYY-MM-DD
  playerId: string;
  name: string;
  pos: NbaPos | null;
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

export type NbaTeamGame = {
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
  /** Game length in minutes (48, 53 with one OT, ...), from player minutes. */
  minutes: number;
};

export const seasonLabel = (season: number) => `${season - 1}-${String(season).slice(2)}`;

/** The season label that is current (or next up) on this date: Oct-Dec belong to the next year's label. */
export const seasonFor = (d = new Date()) => (d.getUTCMonth() >= 8 ? d.getUTCFullYear() + 1 : d.getUTCFullYear());

const num = (s: string | undefined) => (s === undefined || s === '' || s === 'NA' ? 0 : Number(s) || 0);
const REGULAR = '2';

const PLAYER_COLS = [
  'game_id', 'season', 'season_type', 'game_date', 'athlete_id', 'athlete_display_name', 'athlete_position_abbreviation',
  'team_id', 'team_abbreviation', 'opponent_team_abbreviation', 'home_away', 'starter', 'did_not_play', 'minutes', 'points',
  'rebounds', 'offensive_rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'field_goals_made', 'field_goals_attempted',
  'three_point_field_goals_made', 'three_point_field_goals_attempted', 'free_throws_made', 'free_throws_attempted',
];

/** Regular-season player games (played minutes only), NBA teams only (no All-Star rows). */
export function nbaPlayerGames(season: number): Promise<NbaPlayerGame[]> {
  return cached(`nba-players-${season}`, async () => {
    const out: NbaPlayerGame[] = [];
    await streamCsv(`${RELEASES}/espn_nba_player_boxscores/player_box_${season}.csv`, PLAYER_COLS, (r) => {
      if (r.season_type !== REGULAR || r.did_not_play === 'true' || !NBA_TEAMS[r.team_abbreviation] || !NBA_TEAMS[r.opponent_team_abbreviation]) return;
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
        starter: r.starter === 'true',
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
    return out;
  });
}

const TEAM_COLS = [
  'game_id', 'season_type', 'game_date', 'team_abbreviation', 'opponent_team_abbreviation', 'team_home_away', 'team_score',
  'field_goals_made', 'field_goals_attempted', 'three_point_field_goals_made', 'three_point_field_goals_attempted',
  'free_throws_made', 'free_throws_attempted', 'offensive_rebounds', 'defensive_rebounds', 'assists', 'total_turnovers',
  'points_in_paint', 'fast_break_points',
];

/** Regular-season team games with possessions and game length. */
export function nbaTeamGames(season: number): Promise<NbaTeamGame[]> {
  return cached(`nba-teams-${season}`, async () => {
    const [players] = await Promise.all([nbaPlayerGames(season)]);
    const minutes = new Map<string, number>();
    for (const p of players) minutes.set(`${p.gameId}|${p.team}`, (minutes.get(`${p.gameId}|${p.team}`) ?? 0) + p.min);

    const rows: Array<Omit<NbaTeamGame, 'poss' | 'minutes'>> = [];
    await streamCsv(`${RELEASES}/espn_nba_team_boxscores/team_box_${season}.csv`, TEAM_COLS, (r) => {
      if (r.season_type !== REGULAR || !NBA_TEAMS[r.team_abbreviation] || !NBA_TEAMS[r.opponent_team_abbreviation]) return;
      rows.push({
        gameId: r.game_id,
        season,
        date: r.game_date,
        team: r.team_abbreviation,
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
    // Basketball-Reference possessions (offensive-rebound share discounts misses). Matches
    // NBA.com's play-by-play possession counts within ~1% per team-season (validate-nba.mts).
    const side = (t: (typeof rows)[number], o: (typeof rows)[number]) => {
      const orbShare = t.oreb + o.dreb ? t.oreb / (t.oreb + o.dreb) : 0;
      return t.fga + 0.4 * t.fta - 1.07 * orbShare * (t.fga - t.fgm) + t.tov;
    };
    const byKey = new Map(rows.map((t) => [`${t.gameId}|${t.team}`, t]));
    return rows
      .filter((t) => byKey.has(`${t.gameId}|${t.opp}`))
      .map((t) => {
        const o = byKey.get(`${t.gameId}|${t.opp}`)!;
        const played = (minutes.get(`${t.gameId}|${t.team}`) ?? 240) / 5;
        // Regulation is 48; each overtime adds 5. Player minutes are rounded, so snap to that grid.
        const length = Math.max(48, 48 + Math.round((played - 48) / 5) * 5);
        return { ...t, poss: (side(t, o) + side(o, t)) / 2, minutes: length };
      });
  });
}

/** Latest season with box scores published: the current label if its file exists, else the one before. */
export function latestNbaSeason(): Promise<number> {
  return cached('nba-latest', async () => {
    const cur = seasonFor();
    const res = await fetch(`${RELEASES}/espn_nba_player_boxscores/player_box_${cur}.csv`, { method: 'HEAD', cache: 'no-store' });
    return res.ok ? cur : cur - 1;
  });
}

// ---------------------------------------------------------------------------
// Upcoming slate (ESPN scoreboard) and current rosters
// ---------------------------------------------------------------------------

export type UpcomingNbaGame = {
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

/** The next day with regular-season games that haven't started (scans ESPN's calendar). */
export function nextNbaSlate(): Promise<{ date: string; games: UpcomingNbaGame[] } | null> {
  return cached('nba-slate', async () => {
    const board = await fetch(`${ESPN}/scoreboard`, { cache: 'no-store' }).then((r) => r.json());
    const calendar: string[] = board?.leagues?.[0]?.calendar ?? [];
    // Calendar entries are midnight Pacific in UTC ("2026-10-20T07:00Z"); the date part is the US game day.
    const today = new Date(Date.now() - 8 * 3600_000).toISOString().slice(0, 10);
    const days = calendar.map((d) => d.slice(0, 10)).filter((d) => d >= today).slice(0, 40);
    for (const day of days) {
      const json = await fetch(`${ESPN}/scoreboard?seasontype=2&dates=${day.replaceAll('-', '')}`, { cache: 'no-store' }).then((r) => r.json());
      const games: UpcomingNbaGame[] = ((json?.events ?? []) as EspnEvent[])
        .filter((e) => e.season?.type === 2 && e.competitions[0]?.status?.type?.state === 'pre')
        .map((e) => {
          const c = e.competitions[0].competitors;
          const home = c.find((x) => x.homeAway === 'home')!.team;
          const away = c.find((x) => x.homeAway === 'away')!.team;
          return { id: e.id, tipoff: e.date, home: home.abbreviation, away: away.abbreviation, homeId: home.id, awayId: away.id };
        })
        .filter((g) => NBA_TEAMS[g.home] && NBA_TEAMS[g.away]);
      if (games.length) return { date: day, games };
    }
    return null;
  });
}

/** ESPN athlete ids on a team's current roster (same ids as the box scores). */
export function nbaRoster(espnTeamId: string): Promise<Set<string>> {
  return cached(`nba-roster-${espnTeamId}`, async () => {
    const json = await fetch(`${ESPN}/teams/${espnTeamId}/roster`, { cache: 'no-store' }).then((r) => r.json());
    const athletes: Array<{ id: string }> = json?.athletes ?? [];
    return new Set(athletes.map((a) => a.id));
  });
}
