/**
 * nflverse data (https://github.com/nflverse/nflverse-data): free, public
 * weekly box scores and schedules, refreshed by nflverse after each game day.
 * No sportsbook data — the research pages are built only from what happened
 * on the field.
 */

const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download';
const TTL_MS = 60 * 60 * 1000; // re-pull at most hourly per server instance

export type PlayerWeek = {
  playerId: string;
  name: string;
  position: string;
  team: string;
  opponent: string;
  gameId: string;
  season: number;
  week: number;
  seasonType: string;
  [stat: string]: string | number;
};

export type Game = {
  gameId: string;
  season: number;
  week: number;
  gameType: string;
  gameday: string;
  gametime: string;
  away: string;
  home: string;
  awayScore: number | null;
  homeScore: number | null;
};

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, commas inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const cache = new Map<string, { at: number; data: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as Promise<T>;
  const data = load().catch((err) => {
    cache.delete(key); // don't pin a failed fetch for an hour
    throw err;
  });
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function fetchCsv(path: string): Promise<Record<string, string>[]> {
  // no-store: these files (1–9 MB) exceed Next's 2 MB data-cache entry limit;
  // the in-memory cache above plus CDN headers on the route do the caching.
  const res = await fetch(`${RELEASES}/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`nflverse ${path}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

const TEXT_COLS = new Set([
  'player_id', 'player_name', 'player_display_name', 'position', 'position_group', 'headshot_url',
  'season_type', 'game_id', 'team', 'opponent_team',
]);

export function playerWeeks(season: number): Promise<PlayerWeek[]> {
  return cached(`weeks-${season}`, async () => {
    const rows = await fetchCsv(`stats_player/stats_player_week_${season}.csv`);
    return rows.map((r) => {
      const out: PlayerWeek = {
        playerId: r.player_id,
        name: r.player_display_name || r.player_name,
        position: r.position,
        team: r.team,
        opponent: r.opponent_team,
        gameId: r.game_id,
        season: Number(r.season),
        week: Number(r.week),
        seasonType: r.season_type,
      };
      for (const [k, v] of Object.entries(r)) {
        if (!TEXT_COLS.has(k) && k !== 'season' && k !== 'week') out[k] = v === '' || v === 'NA' ? 0 : Number(v) || 0;
      }
      return out;
    });
  });
}

export function schedule(season: number): Promise<Game[]> {
  return cached(`games-${season}`, async () => {
    const rows = await fetchCsv('schedules/games.csv');
    return rows
      .filter((r) => Number(r.season) === season)
      .map((r) => ({
        gameId: r.game_id,
        season: Number(r.season),
        week: Number(r.week),
        gameType: r.game_type,
        gameday: r.gameday,
        gametime: r.gametime,
        away: r.away_team,
        home: r.home_team,
        awayScore: r.away_score === '' || r.away_score === 'NA' ? null : Number(r.away_score),
        homeScore: r.home_score === '' || r.home_score === 'NA' ? null : Number(r.home_score),
      }));
  });
}

export const TEAM_NAMES: Record<string, { city: string; nickname: string }> = {
  ARI: { city: 'Arizona', nickname: 'Cardinals' }, ATL: { city: 'Atlanta', nickname: 'Falcons' },
  BAL: { city: 'Baltimore', nickname: 'Ravens' }, BUF: { city: 'Buffalo', nickname: 'Bills' },
  CAR: { city: 'Carolina', nickname: 'Panthers' }, CHI: { city: 'Chicago', nickname: 'Bears' },
  CIN: { city: 'Cincinnati', nickname: 'Bengals' }, CLE: { city: 'Cleveland', nickname: 'Browns' },
  DAL: { city: 'Dallas', nickname: 'Cowboys' }, DEN: { city: 'Denver', nickname: 'Broncos' },
  DET: { city: 'Detroit', nickname: 'Lions' }, GB: { city: 'Green Bay', nickname: 'Packers' },
  HOU: { city: 'Houston', nickname: 'Texans' }, IND: { city: 'Indianapolis', nickname: 'Colts' },
  JAX: { city: 'Jacksonville', nickname: 'Jaguars' }, KC: { city: 'Kansas City', nickname: 'Chiefs' },
  LV: { city: 'Las Vegas', nickname: 'Raiders' }, LAC: { city: 'Los Angeles', nickname: 'Chargers' },
  LA: { city: 'Los Angeles', nickname: 'Rams' }, MIA: { city: 'Miami', nickname: 'Dolphins' },
  MIN: { city: 'Minnesota', nickname: 'Vikings' }, NE: { city: 'New England', nickname: 'Patriots' },
  NO: { city: 'New Orleans', nickname: 'Saints' }, NYG: { city: 'New York', nickname: 'Giants' },
  NYJ: { city: 'New York', nickname: 'Jets' }, PHI: { city: 'Philadelphia', nickname: 'Eagles' },
  PIT: { city: 'Pittsburgh', nickname: 'Steelers' }, SF: { city: 'San Francisco', nickname: '49ers' },
  SEA: { city: 'Seattle', nickname: 'Seahawks' }, TB: { city: 'Tampa Bay', nickname: 'Buccaneers' },
  TEN: { city: 'Tennessee', nickname: 'Titans' }, WAS: { city: 'Washington', nickname: 'Commanders' },
};

export const nickname = (abbr: string) => TEAM_NAMES[abbr]?.nickname ?? abbr;

export type SnapCount = {
  gameId: string;
  season: number;
  week: number;
  gameType: string;
  player: string;
  team: string;
  offensePct: number; // 0–1
};

/** Offensive snap share per player-game (nflverse's copy of PFR snap counts). */
export function snapCounts(season: number): Promise<SnapCount[]> {
  return cached(`snaps-${season}`, async () => {
    const rows = await fetchCsv(`snap_counts/snap_counts_${season}.csv`);
    return rows.map((r) => ({
      gameId: r.game_id,
      season: Number(r.season),
      week: Number(r.week),
      gameType: r.game_type,
      player: r.player,
      team: r.team,
      offensePct: Number(r.offense_pct) || 0,
    }));
  });
}

/**
 * Join key for names across nflverse files, which disagree on suffixes and
 * punctuation ("Chris Godwin Jr." vs "Chris Godwin", "D.J. Moore" vs "DJ Moore").
 */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z]/g, '');
}
