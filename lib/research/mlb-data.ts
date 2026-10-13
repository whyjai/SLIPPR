/**
 * MLB inputs: play-by-play from sportsdataverse (one row per play, sourced
 * from MLB's StatsAPI) plus MLB StatsAPI's public schedule, teams and player
 * list (names, positions, bat/throw hands) and probable pitchers.
 *
 * `season` is the calendar year.
 */
import { cached, streamCsv } from './csv';

const PBP = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/mlb_pbp';
const API = 'https://statsapi.mlb.com/api/v1';

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`MLB StatsAPI ${path.split('?')[0]}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Teams, players, schedule
// ---------------------------------------------------------------------------

export type MlbTeam = { id: number; abbr: string; name: string; city: string; nickname: string };

export function mlbTeams(season: number): Promise<Map<number, MlbTeam>> {
  return cached(`mlb-teams-${season}`, async () => {
    type T = { id: number; abbreviation: string; name: string; teamName: string; locationName?: string; franchiseName?: string };
    const json = await api<{ teams: T[] }>(`/teams?sportId=1&season=${season}`);
    return new Map(
      json.teams.map((t) => [t.id, { id: t.id, abbr: t.abbreviation, name: t.name, city: t.franchiseName ?? t.locationName ?? '', nickname: t.teamName }]),
    );
  });
}

export type Hand = 'L' | 'R';
export type MlbPerson = { id: number; name: string; pos: string; bats: Hand | 'S'; throws: Hand; teamId: number | null };

export function mlbPeople(season: number): Promise<Map<number, MlbPerson>> {
  return cached(`mlb-people-${season}`, async () => {
    type P = { id: number; fullName: string; primaryPosition?: { abbreviation: string }; batSide?: { code: string }; pitchHand?: { code: string }; currentTeam?: { id: number } };
    const json = await api<{ people: P[] }>(`/sports/1/players?season=${season}`);
    return new Map(
      json.people.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.fullName,
          pos: p.primaryPosition?.abbreviation ?? '',
          bats: (p.batSide?.code ?? 'R') as Hand | 'S',
          throws: (p.pitchHand?.code === 'L' ? 'L' : 'R') as Hand,
          teamId: p.currentTeam?.id ?? null,
        },
      ]),
    );
  });
}

export type MlbGame = {
  gamePk: number;
  date: string; // official date, YYYY-MM-DD
  type: string; // R regular, F/D/L/W postseason
  home: number; // team id
  away: number;
  homeScore: number | null;
  awayScore: number | null;
  final: boolean;
  venueId: number;
  venue: string;
};

type ScheduleJson = {
  dates: Array<{
    date: string;
    games: Array<{
      gamePk: number;
      gameType: string;
      officialDate?: string;
      gameDate: string;
      status: { abstractGameState: string; detailedState: string };
      venue: { id: number; name: string };
      teams: {
        home: { team: { id: number }; score?: number; probablePitcher?: { id: number; fullName: string } };
        away: { team: { id: number }; score?: number; probablePitcher?: { id: number; fullName: string } };
      };
    }>;
  }>;
};

/** Every regular-season and postseason game of a season, with final scores. */
export function mlbSchedule(season: number): Promise<MlbGame[]> {
  return cached(`mlb-schedule-${season}`, async () => {
    const json = await api<ScheduleJson>(`/schedule?sportId=1&season=${season}&gameType=R,F,D,L,W`);
    const out: MlbGame[] = [];
    for (const d of json.dates) {
      for (const g of d.games) {
        const final = g.status.abstractGameState === 'Final' && g.status.detailedState !== 'Postponed' && g.status.detailedState !== 'Cancelled';
        out.push({
          gamePk: g.gamePk,
          date: g.officialDate ?? d.date,
          type: g.gameType,
          home: g.teams.home.team.id,
          away: g.teams.away.team.id,
          homeScore: g.teams.home.score ?? null,
          awayScore: g.teams.away.score ?? null,
          final,
          venueId: g.venue.id,
          venue: g.venue.name,
        });
      }
    }
    // A suspended game can appear on two dates; keep its last (completed) entry.
    return [...new Map(out.map((g) => [g.gamePk, g])).values()];
  });
}

// ---------------------------------------------------------------------------
// Plays
// ---------------------------------------------------------------------------

const HITS = new Set(['single', 'double', 'triple', 'home_run']);
const TB: Record<string, number> = { single: 1, double: 2, triple: 3, home_run: 4 };
/** Events that end a plate appearance. Caught stealing, pickoffs, wild pitches etc. don't. */
const PA_EVENTS = new Set([
  ...HITS,
  'walk', 'intent_walk', 'hit_by_pitch', 'strikeout', 'strikeout_double_play', 'strikeout_triple_play',
  'sac_fly', 'sac_fly_double_play', 'sac_bunt', 'sac_bunt_double_play', 'catcher_interf',
  'field_out', 'force_out', 'grounded_into_double_play', 'double_play', 'triple_play',
  'fielders_choice', 'fielders_choice_out', 'field_error',
]);

export type MlbPlay = {
  gamePk: number;
  date: string;
  type: string;
  batter: number;
  pitcher: number;
  bat: number; // batting team id
  fld: number; // fielding team id
  event: string;
  pa: boolean;
  outs: number; // outs recorded on the play (incl. caught stealing / pickoffs)
  runs: number; // runs that scored on the play
  rbi: number;
};

const num = (s: string) => (s === '' || s === 'NA' ? 0 : Number(s) || 0);

/** All plays of a season's final games, in order, joined to the schedule (dates, teams). */
export function mlbPlays(season: number): Promise<MlbPlay[]> {
  return cached(`mlb-plays-${season}`, async () => {
    const games = new Map((await mlbSchedule(season)).filter((g) => g.final).map((g) => [g.gamePk, g]));
    const rows: Array<Record<string, string>> = [];
    await streamCsv(
      `${PBP}/mlb_pbp_${season}.csv.gz`,
      ['game_pk', 'at_bat_index', 'inning', 'half_inning', 'batter_id', 'pitcher_id', 'event_type', 'rbi', 'away_score', 'home_score', 'outs'],
      (r) => {
        if (games.has(Number(r.game_pk))) rows.push(r);
      },
    );
    rows.sort((a, b) => Number(a.game_pk) - Number(b.game_pk) || Number(a.at_bat_index) - Number(b.at_bat_index));
    const out: MlbPlay[] = [];
    let prev: Record<string, string> | null = null;
    for (const r of rows) {
      const g = games.get(Number(r.game_pk))!;
      const top = r.half_inning === 'top';
      const sameHalf = prev && prev.game_pk === r.game_pk && prev.inning === r.inning && prev.half_inning === r.half_inning;
      const sameGame = prev && prev.game_pk === r.game_pk;
      // `outs` and the scores are after the play.
      const outsBefore = sameHalf ? num(prev!.outs) : 0;
      const scoreKey = top ? 'away_score' : 'home_score';
      const runsBefore = sameGame ? num(prev![scoreKey]) : 0;
      out.push({
        gamePk: g.gamePk,
        date: g.date,
        type: g.type,
        batter: Number(r.batter_id),
        pitcher: Number(r.pitcher_id),
        bat: top ? g.away : g.home,
        fld: top ? g.home : g.away,
        event: r.event_type,
        pa: PA_EVENTS.has(r.event_type),
        outs: Math.max(0, num(r.outs) - outsBefore),
        runs: Math.max(0, num(r[scoreKey]) - runsBefore),
        rbi: num(r.rbi),
      });
      prev = r;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/** Additive batting line; works for a hitter, a team, or a pitcher's opponents. */
export type Line = {
  pa: number;
  ab: number;
  h: number;
  b1: number;
  b2: number;
  b3: number;
  hr: number;
  tb: number;
  bb: number; // incl. intentional
  ibb: number;
  hbp: number;
  k: number;
  sf: number;
  rbi: number;
  outs: number;
  runs: number;
};

export const emptyLine = (): Line => ({ pa: 0, ab: 0, h: 0, b1: 0, b2: 0, b3: 0, hr: 0, tb: 0, bb: 0, ibb: 0, hbp: 0, k: 0, sf: 0, rbi: 0, outs: 0, runs: 0 });

export function addPlay(l: Line, p: MlbPlay) {
  l.outs += p.outs;
  l.runs += p.runs;
  if (!p.pa) return;
  const e = p.event;
  l.pa++;
  l.rbi += p.rbi;
  if (e === 'walk' || e === 'intent_walk') {
    l.bb++;
    if (e === 'intent_walk') l.ibb++;
  } else if (e === 'hit_by_pitch') l.hbp++;
  else if (e.startsWith('sac_fly')) l.sf++;
  else if (e.startsWith('sac_bunt') || e === 'catcher_interf') {
    // not an at-bat
  } else {
    l.ab++;
    if (e.startsWith('strikeout')) l.k++;
    if (HITS.has(e)) {
      l.h++;
      l.tb += TB[e];
      if (e === 'single') l.b1++;
      if (e === 'double') l.b2++;
      if (e === 'triple') l.b3++;
      if (e === 'home_run') l.hr++;
    }
  }
}

export function addLine(a: Line, b: Line) {
  for (const k of Object.keys(a) as Array<keyof Line>) a[k] += b[k];
}

/** wOBA with standard (FanGraphs-style) linear weights; close enough year to year for ranking. */
export function woba(l: Line): number | null {
  const den = l.ab + l.bb - l.ibb + l.sf + l.hbp;
  if (!den) return null;
  return (0.69 * (l.bb - l.ibb) + 0.72 * l.hbp + 0.88 * l.b1 + 1.25 * l.b2 + 1.59 * l.b3 + 2.05 * l.hr) / den;
}

export const rate = (x: number, d: number) => (d ? x / d : null);

export function slash(l: Line) {
  const avg = rate(l.h, l.ab);
  const obp = rate(l.h + l.bb + l.hbp, l.ab + l.bb + l.hbp + l.sf);
  const slg = rate(l.tb, l.ab);
  return { avg, obp, slg, ops: obp != null && slg != null ? obp + slg : null, iso: slg != null && avg != null ? slg - avg : null };
}

/** FIP with a fixed constant (~3.1); fine for ranking within a season. */
export function fip(l: Line): number | null {
  const ip = l.outs / 3;
  return ip ? (13 * l.hr + 3 * (l.bb + l.hbp) - 2 * l.k) / ip + 3.1 : null;
}

/** Latest season with play-by-play: this year if its file exists, else last year. */
export function latestMlbSeason(): Promise<number> {
  return cached('mlb-latest', async () => {
    const year = new Date().getUTCFullYear();
    const res = await fetch(`${PBP}/mlb_pbp_${year}.csv.gz`, { method: 'HEAD', cache: 'no-store' });
    return res.ok ? year : year - 1;
  });
}

// ---------------------------------------------------------------------------
// Upcoming slate with probable pitchers
// ---------------------------------------------------------------------------

export type UpcomingMlbGame = {
  gamePk: number;
  start: string; // ISO
  type: string;
  home: number;
  away: number;
  venueId: number;
  venue: string;
  homeProbable: { id: number; name: string } | null;
  awayProbable: { id: number; name: string } | null;
};

/** The next day (within two weeks) with games that haven't started. */
export function nextMlbSlate(): Promise<{ date: string; games: UpcomingMlbGame[] } | null> {
  return cached('mlb-slate', async () => {
    const today = new Date(Date.now() - 8 * 3600_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
    const json = await api<ScheduleJson>(`/schedule?sportId=1&startDate=${today}&endDate=${end}&gameType=R,F,D,L,W&hydrate=probablePitcher`);
    for (const d of json.dates) {
      const games = d.games
        .filter((g) => g.status.abstractGameState === 'Preview')
        .map((g) => ({
          gamePk: g.gamePk,
          start: g.gameDate,
          type: g.gameType,
          home: g.teams.home.team.id,
          away: g.teams.away.team.id,
          venueId: g.venue.id,
          venue: g.venue.name,
          homeProbable: g.teams.home.probablePitcher ? { id: g.teams.home.probablePitcher.id, name: g.teams.home.probablePitcher.fullName } : null,
          awayProbable: g.teams.away.probablePitcher ? { id: g.teams.away.probablePitcher.id, name: g.teams.away.probablePitcher.fullName } : null,
        }));
      if (games.length) return { date: d.date, games };
    }
    return null;
  });
}
