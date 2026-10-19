/**
 * NHL inputs: the NHL's public stats API (per-game skater and goalie lines),
 * its schedule and rosters (api-web), and ESPN's injury report (matched by name;
 * ESPN and the NHL use different player ids).
 *
 * `season` is the year a season starts: 2026 = 2026-27 (NHL id 20262027).
 */
import { cached } from './csv';

const STATS = 'https://api.nhle.com/stats/rest/en';
const WEB = 'https://api-web.nhle.com/v1';

export const nhlSeasonId = (season: number) => `${season}${season + 1}`;
/** NHL seasons start in October: Sept-Dec belong to that year, Jan-Aug to the year before. */
export const nhlSeasonFor = (d = new Date()) => (d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);

export type NhlSkaterGame = {
  gameId: number;
  date: string;
  playerId: number;
  name: string;
  pos: string; // C, L, R, D
  team: string;
  opp: string;
  home: boolean;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  toi: number; // minutes
  ppPoints: number;
};

export type NhlGoalieGame = {
  gameId: number;
  date: string;
  playerId: number;
  name: string;
  team: string;
  opp: string;
  home: boolean;
  started: boolean;
  saves: number;
  shotsAgainst: number;
  goalsAgainst: number;
};

async function json<T>(url: string): Promise<T> {
  // api-web rate-limits bursts (429): back off and retry a few times.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0 (research)' } });
    if (res.ok) return res.json() as Promise<T>;
    if (res.status !== 429 || attempt >= 3) throw new Error(`NHL ${url.split('?')[0].split('/').slice(-2).join('/')}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
}

/** ESPN abbreviations that differ from the NHL's. */
const ESPN_TO_NHL: Record<string, string> = { NJ: 'NJD', TB: 'TBL', LA: 'LAK', SJ: 'SJS', UTAH: 'UTA' };

/** Half-month windows from September to June, so no request hits the API's 10,000-row cap. */
function windows(season: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let m = 0; m < 10; m++) {
    const y = m < 4 ? season : season + 1;
    const month = ((8 + m) % 12) + 1;
    const mm = String(month).padStart(2, '0');
    const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
    out.push([`${y}-${mm}-01`, `${y}-${mm}-15`], [`${y}-${mm}-16`, `${y}-${mm}-${last}`]);
  }
  return out;
}

async function perGame<T>(kind: 'skater' | 'goalie', season: number): Promise<T[]> {
  const rows: T[] = [];
  await Promise.all(
    windows(season).map(async ([from, to]) => {
      const exp = encodeURIComponent(`seasonId=${nhlSeasonId(season)} and gameTypeId=2 and gameDate>="${from}" and gameDate<="${to} 23:59:59"`);
      const j = await json<{ data: T[] }>(`${STATS}/${kind}/summary?isAggregate=false&isGame=true&start=0&limit=-1&cayenneExp=${exp}`);
      rows.push(...j.data);
    }),
  );
  return rows;
}

/** Regular-season skater games. */
export function nhlSkaterGames(season: number): Promise<NhlSkaterGame[]> {
  return cached(`nhl-skaters-${season}`, async () => {
    type R = { gameId: number; gameDate: string; playerId: number; skaterFullName: string; positionCode: string; teamAbbrev: string; opponentTeamAbbrev: string; homeRoad: string; goals: number; assists: number; points: number; shots: number; timeOnIcePerGame: number; ppPoints: number };
    return (await perGame<R>('skater', season)).map((r) => ({
      gameId: r.gameId,
      date: r.gameDate.slice(0, 10),
      playerId: r.playerId,
      name: r.skaterFullName,
      pos: r.positionCode,
      team: r.teamAbbrev,
      opp: r.opponentTeamAbbrev,
      home: r.homeRoad === 'H',
      goals: r.goals ?? 0,
      assists: r.assists ?? 0,
      points: r.points ?? 0,
      shots: r.shots ?? 0,
      toi: (r.timeOnIcePerGame ?? 0) / 60,
      ppPoints: r.ppPoints ?? 0,
    }));
  });
}

/** Regular-season goalie games. */
export function nhlGoalieGames(season: number): Promise<NhlGoalieGame[]> {
  return cached(`nhl-goalies-${season}`, async () => {
    type R = { gameId: number; gameDate: string; playerId: number; goalieFullName: string; teamAbbrev: string; opponentTeamAbbrev: string; homeRoad: string; gamesStarted: number; saves: number; shotsAgainst: number; goalsAgainst: number };
    return (await perGame<R>('goalie', season)).map((r) => ({
      gameId: r.gameId,
      date: r.gameDate.slice(0, 10),
      playerId: r.playerId,
      name: r.goalieFullName,
      team: r.teamAbbrev,
      opp: r.opponentTeamAbbrev,
      home: r.homeRoad === 'H',
      started: (r.gamesStarted ?? 0) > 0,
      saves: r.saves ?? 0,
      shotsAgainst: r.shotsAgainst ?? 0,
      goalsAgainst: r.goalsAgainst ?? 0,
    }));
  });
}

export type NhlUpcomingGame = { id: number; start: string; home: string; away: string };

/** The next day (within two weeks) with regular-season or playoff games that haven't started. */
export function nextNhlSlate(): Promise<{ date: string; games: NhlUpcomingGame[] } | null> {
  return cached('nhl-slate', async () => {
    type S = { gameWeek: Array<{ date: string; games: Array<{ id: number; gameType: number; startTimeUTC: string; gameState: string; homeTeam: { abbrev: string }; awayTeam: { abbrev: string } }> }> };
    const today = new Date(Date.now() - 8 * 3600_000).toISOString().slice(0, 10);
    try {
      for (const start of [today, new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)]) {
        const s = await json<S>(`${WEB}/schedule/${start}`);
        for (const day of s.gameWeek) {
          const games = day.games
            .filter((g) => (g.gameType === 2 || g.gameType === 3) && (g.gameState === 'FUT' || g.gameState === 'PRE'))
            .map((g) => ({ id: g.id, start: g.startTimeUTC, home: g.homeTeam.abbrev, away: g.awayTeam.abbrev }));
          if (games.length) return { date: day.date, games };
        }
      }
      return null;
    } catch {
      // Fallback: ESPN's scoreboard (its game ids aren't the NHL's, so grading matches by date and teams).
      type E = { events?: Array<{ id: string; date: string; competitions: Array<{ status: { type: { state: string } }; competitors: Array<{ homeAway: string; team: { abbreviation: string } }> }> }> };
      for (let d = 0; d < 14; d++) {
        const day = new Date(Date.now() - 8 * 3600_000 + d * 86400_000).toISOString().slice(0, 10);
        const e = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${day.replaceAll('-', '')}`, { cache: 'no-store' }).then((r) => r.json() as Promise<E>);
        const games = (e.events ?? [])
          .filter((ev) => ev.competitions[0].status.type.state === 'pre')
          .map((ev) => {
            const c = ev.competitions[0].competitors;
            const ab = (side: string) => {
              const a = c.find((x) => x.homeAway === side)!.team.abbreviation;
              return ESPN_TO_NHL[a] ?? a;
            };
            return { id: Number(ev.id), start: ev.date, home: ab('home'), away: ab('away') };
          });
        if (games.length) return { date: day, games };
      }
      return null;
    }
  });
}

/** Current roster player ids. */
export function nhlRoster(team: string): Promise<Set<number>> {
  return cached(`nhl-roster-${team}`, async () => {
    type R = Record<'forwards' | 'defensemen' | 'goalies', Array<{ id: number }>>;
    const r = await json<R>(`${WEB}/roster/${team}/current`);
    return new Set([...(r.forwards ?? []), ...(r.defensemen ?? []), ...(r.goalies ?? [])].map((p) => p.id));
  });
}

export const nameKey = (n: string) =>
  n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** ESPN NHL injury report, by normalized name. */
export function nhlInjuries(): Promise<Map<string, { status: string; note: string }>> {
  return cached('nhl-injuries', async () => {
    type J = { injuries?: Array<{ injuries?: Array<{ status: string; shortComment?: string; athlete: { displayName: string } }> }> };
    const j = await json<J>('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries');
    const out = new Map<string, { status: string; note: string }>();
    for (const t of j.injuries ?? []) for (const i of t.injuries ?? []) out.set(nameKey(i.athlete.displayName), { status: i.status, note: i.shortComment ?? '' });
    return out;
  });
}
