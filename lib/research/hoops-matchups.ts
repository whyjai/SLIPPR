/**
 * Basketball matchup research for the next slate: team profiles, a ratings-based
 * game estimate, the extremes in each defense's profile, and key players with
 * a (small) opponent-style adjustment.
 *
 * What the numbers are worth (NBA), measured by scripts/research/audit-hoops.mts:
 *  - team pace / ratings / shot profile are stable (first 20 games vs rest r 0.6-0.8)
 *  - the ratings-based total and margin, first half of a season predicting the
 *    second: total r 0.30-0.41 (typical miss ~15 pts), margin r 0.39-0.46 (~12 pts)
 *  - opponent style moves a player's line only ~1-5% per SD; fit on 2024-25
 *    and tested on 2025-26 it cut player-line error by 0.1-0.9%. Shown, labeled small.
 */
import {
  LEAGUES,
  latestSeason,
  nextSlate,
  playerGames,
  roster,
  seasonFor,
  seasonLabel,
  teamGames,
  teamNames,
  type HoopsPos,
  type League,
} from './hoops-data';
import { teamStyles, type TeamStyle } from './hoops-teams';

export type StyleStat = 'pts' | 'reb' | 'ast' | 'fg3m' | 'pra';
export type StyleKey = 'pace' | 'drtg' | 'oppThreeRate' | 'oppPaint';

/** Which opponent-style numbers move which stat. */
export const STYLE_PREDICTORS: Record<StyleStat, StyleKey[]> = {
  pts: ['pace', 'drtg', 'oppPaint'],
  reb: ['pace', 'drtg'],
  ast: ['pace', 'drtg'],
  fg3m: ['pace', 'oppThreeRate'],
  pra: ['pace', 'drtg', 'oppPaint'],
};

/**
 * Fractional change in a player's line per +1 SD of the opponent's style, in
 * STYLE_PREDICTORS order. NBA: fit on 2024-25 by scripts/research/audit-hoops.mts
 * (players 20+ mpg, opponent's first-half style vs the player's second-half
 * games) and tested on 2025-26. Cells whose test error got worse are zeroed:
 * F 3PM and PRA, C rebounds and 3PM. Even the kept ones cut error < 1%.
 */
type Effects = Record<HoopsPos, Record<StyleStat, number[]>>;
const NBA_EFFECTS: Effects = {
  G: { pts: [0.016, 0.017, 0.005], reb: [0.013, 0.021], ast: [0.027, 0.05], fg3m: [0.034, 0.038], pra: [0.015, 0.02, 0.01] },
  F: { pts: [0.012, 0.024, -0.005], reb: [0.009, 0.002], ast: [-0.012, 0.039], fg3m: [0, 0], pra: [0, 0, 0] },
  C: { pts: [0.034, 0.05, -0.012], reb: [0, 0], ast: [0.015, 0.052], fg3m: [0, 0], pra: [0.017, 0.05, -0.025] },
};

/**
 * WNBA: none. Fit on 2025 and tested on 2026 (audit-hoops.mts wnba 2025 2026),
 * opponent style didn't improve player lines (error -0.8% to +13.5%), so the
 * WNBA shows plain averages.
 */
const ZERO = { pts: [0, 0, 0], reb: [0, 0], ast: [0, 0], fg3m: [0, 0], pra: [0, 0, 0] };
const WNBA_EFFECTS: Effects = { G: ZERO, F: ZERO, C: ZERO };

const STYLE_EFFECTS: Record<League, Effects> = { nba: NBA_EFFECTS, wnba: WNBA_EFFECTS };

export type TeamLine = {
  team: string;
  name: string;
  pace: number;
  paceRank: number;
  ortg: number;
  ortgRank: number;
  drtg: number;
  drtgRank: number; // #1 = best defense (fewest allowed)
};

export type Averages = Record<StyleStat, number> & { min: number; games: number };

export type PlayerLine = {
  id: string;
  name: string;
  pos: HoopsPos | null;
  season: Averages;
  last10: Averages;
  /** % change the opponent's style implies for each stat (small by design, see header). */
  adj: Record<StyleStat, number>;
};

export type GameCard = {
  id: string;
  tipoff: string;
  away: TeamLine;
  home: TeamLine;
  estimate: { pace: number; away: number; home: number; total: number; margin: number };
  notes: string[];
  players: { away: PlayerLine[]; home: PlayerLine[] };
};

export type Slate = {
  date: string;
  basisSeason: number;
  basisLabel: string;
  /** False when the league has no tested opponent-style adjustment (the WNBA). */
  adjustments: boolean;
  /** True when the current season is too young and last season's numbers are used. */
  usingLastSeason: boolean;
  leaguePace: number;
  leagueRating: number;
  homeEdge: number;
  games: GameCard[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const STATS: StyleStat[] = ['pts', 'reb', 'ast', 'fg3m', 'pra'];

function ranks(styles: TeamStyle[], key: keyof TeamStyle, highFirst: boolean) {
  const sorted = [...styles].sort((a, b) => (highFirst ? 1 : -1) * ((b[key] as number) - (a[key] as number)));
  return new Map(sorted.map((s, i) => [s.team, i + 1]));
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** Extremes in a defense's profile worth a line: top or bottom 3 of the league. */
const PROFILE: Array<{ key: keyof TeamStyle; phrase: (place: string, v: number) => string }> = [
  { key: 'oppPaint', phrase: (p, v) => `allows ${p} paint points (${v} per game)` },
  { key: 'oppThreeRate', phrase: (p, v) => `sees ${p} three-point attempts (${v}% of opponent shots)` },
  { key: 'oppOrebPct', phrase: (p, v) => `gives up ${p} offensive rebounds (${v}% of misses)` },
  { key: 'oppFtRate', phrase: (p, v) => `sends opponents to the line ${p} (${v} FTA per 100 shots)` },
  { key: 'forcedTovPct', phrase: (p, v) => `forces ${p} turnovers (${v} per 100 possessions)` },
];

export async function getSlate(league: League): Promise<Slate | null> {
  const slate = await nextSlate(league);
  if (!slate) return null;

  // Which season's numbers describe these teams best right now.
  const latest = await latestSeason(league);
  const cfg = LEAGUES[league];
  let basis = latest;
  let styles = teamStyles(await teamGames(league, latest), cfg.regulation);
  const young = latest === seasonFor(league) && Math.min(...Object.values(styles).map((s) => s.games)) < cfg.minGamesForCurrent;
  if (young) {
    basis = latest - 1;
    styles = teamStyles(await teamGames(league, basis), cfg.regulation);
  }
  const names = await teamNames(league, basis);
  const all = Object.values(styles).filter((s) => names[s.team]);
  const lgPace = mean(all.map((s) => s.pace));
  const lgRtg = mean(all.map((s) => s.ortg));
  const keys = [...new Set(Object.values(STYLE_PREDICTORS).flat())];
  const lgStyle = Object.fromEntries(keys.map((k) => [k, mean(all.map((s) => s[k]))]));
  const sdStyle = Object.fromEntries(keys.map((k) => [k, sd(all.map((s) => s[k]))]));
  const paceRank = ranks(all, 'pace', true);
  const ortgRank = ranks(all, 'ortg', true);
  const drtgRank = ranks(all, 'drtg', false);

  const basisGames = await teamGames(league, basis);
  const ptsByKey = new Map(basisGames.map((g) => [`${g.gameId}|${g.team}`, g.pts]));
  const homeEdge = mean(basisGames.filter((g) => g.home).map((g) => g.pts - (ptsByKey.get(`${g.gameId}|${g.opp}`) ?? g.pts)));

  const players = await playerGames(league, basis);
  const line = (team: string): TeamLine => {
    const s = styles[team];
    return {
      team,
      name: `${names[team].city} ${names[team].nickname}`,
      pace: r1(s.pace),
      paceRank: paceRank.get(team)!,
      ortg: r1(s.ortg),
      ortgRank: ortgRank.get(team)!,
      drtg: r1(s.drtg),
      drtgRank: drtgRank.get(team)!,
    };
  };

  const profileRanks = PROFILE.map((p) => ({ ...p, rank: ranks(all, p.key, true) }));
  const n = all.length;
  const notesFor = (defense: string, offense: string) => {
    const out: string[] = [];
    for (const p of profileRanks) {
      const r = p.rank.get(defense)!;
      if (r > 3 && r < n - 2) continue;
      const most = r <= 3;
      const k = most ? r : n - r + 1;
      const word = p.key === 'oppFtRate' ? (most ? 'most' : 'least') : most ? 'the most' : 'the fewest';
      const place = k === 1 ? word : p.key === 'oppFtRate' ? `${ordinal(k)}-${word}` : `the ${ordinal(k)}-${word.replace('the ', '')}`;
      out.push(`${names[defense].nickname} defense ${p.phrase(place, r1(styles[defense][p.key] as number))}. ${names[offense].nickname} on offense.`);
    }
    return out;
  };

  const averages = (rows: typeof players): Averages => ({
    games: rows.length,
    min: r1(mean(rows.map((r) => r.min))),
    pts: r1(mean(rows.map((r) => r.pts))),
    reb: r1(mean(rows.map((r) => r.reb))),
    ast: r1(mean(rows.map((r) => r.ast))),
    fg3m: r1(mean(rows.map((r) => r.fg3m))),
    pra: r1(mean(rows.map((r) => r.pts + r.reb + r.ast))),
  });

  const keyPlayers = async (team: string, espnTeamId: string, opp: string): Promise<PlayerLine[]> => {
    const current = await roster(league, espnTeamId).catch(() => null);
    const byPlayer = new Map<string, typeof players>();
    for (const p of players) {
      if (current ? !current.has(p.playerId) : p.team !== team) continue;
      byPlayer.set(p.playerId, [...(byPlayer.get(p.playerId) ?? []), p]);
    }
    const oppStyle = styles[opp];
    return [...byPlayer.values()]
      .filter((rows) => rows.length >= 10)
      .map((rows) => {
        rows.sort((a, b) => a.date.localeCompare(b.date));
        const last = rows[rows.length - 1];
        const pos = last.pos;
        const adj = Object.fromEntries(
          STATS.map((stat) => {
            const coef = pos ? STYLE_EFFECTS[league][pos][stat] : null;
            const z = STYLE_PREDICTORS[stat].map((k) => (oppStyle[k] - lgStyle[k]) / (sdStyle[k] || 1));
            return [stat, coef ? r1(100 * coef.reduce((a, c, i) => a + c * z[i], 0)) : 0];
          }),
        ) as Record<StyleStat, number>;
        return { id: last.playerId, name: last.name, pos, season: averages(rows), last10: averages(rows.slice(-10)), adj };
      })
      // In season, recent minutes say who plays now. From last season, whole-season minutes: its last
      // weeks are full of rested stars and tank rotations.
      .sort((a, b) => (basis !== seasonFor(league) ? b.season.min * b.season.games - a.season.min * a.season.games : b.last10.min - a.last10.min))
      .slice(0, 3);
  };

  const games: GameCard[] = [];
  for (const g of slate.games) {
    const H = styles[g.home];
    const A = styles[g.away];
    if (!H || !A) continue;
    const pace = H.pace + A.pace - lgPace;
    const home = (pace / 100) * (H.ortg + A.drtg - lgRtg) + homeEdge / 2;
    const away = (pace / 100) * (A.ortg + H.drtg - lgRtg) - homeEdge / 2;
    games.push({
      id: g.id,
      tipoff: g.tipoff,
      away: line(g.away),
      home: line(g.home),
      estimate: { pace: r1(pace), away: r1(away), home: r1(home), total: r1(home + away), margin: r1(home - away) },
      notes: [...notesFor(g.home, g.away), ...notesFor(g.away, g.home)],
      players: { away: await keyPlayers(g.away, g.awayId, g.home), home: await keyPlayers(g.home, g.homeId, g.away) },
    });
  }
  return {
    date: slate.date,
    basisSeason: basis,
    basisLabel: seasonLabel(league, basis),
    adjustments: Object.values(STYLE_EFFECTS[league]).some((byStat) => Object.values(byStat).some((c) => c.some((x) => x !== 0))),
    usingLastSeason: basis !== seasonFor(league),
    leaguePace: r1(lgPace),
    leagueRating: r1(lgRtg),
    homeEdge: r1(homeEdge),
    games: games.sort((a, b) => a.tipoff.localeCompare(b.tipoff)),
  };
}
