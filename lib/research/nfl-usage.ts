/**
 * NFL usage ("opportunity") model for player props.
 *
 *   stat = team volume × player share × player efficiency
 *
 * - Team volume (pass attempts, targets, carries) from the betting market's
 *   view of the game (implied team total and spread) plus the team's and the
 *   opponent's volume so far: a linear model fit on earlier seasons.
 * - Player share of team targets / carries / attempts: recency-weighted over his
 *   games (last season's count for less), raised when teammates who take
 *   targets or carries are out (their share is handed to the players who play).
 * - Efficiency (catch rate, yards per target / carry / attempt, TD rate):
 *   his own, shrunk toward his position's average by sample size.
 *
 * Parameters come from scripts/research/backtest-nfl-usage.mts (walk-forward:
 * each game uses only earlier games; fit on 2021-2023, tested on 2024-2025).
 */
import { cached } from './csv';
import { nameKey, pfrToGsis, playerWeeks, schedule, snapCounts } from './nflverse';
import { POS_STATS, type PropPos, type PropStat } from './nfl-props';
import MODEL from '../../data/research/nfl-usage-model.json';
import { chanceOver as spreadChance, outcomeAt as spreadOutcome, type SpreadModel } from './props-engine';
import { isOut, nflPlayerStatus, type PlayerStatus } from './nfl-status';

export type UsageGame = {
  id: string;
  name: string;
  pos: PropPos;
  team: string;
  opp: string;
  gameId: string;
  season: number;
  week: number;
  snap: number; // offensive snap share, 0-1 (0 = didn't play)
  tgt: number;
  rec: number;
  recYds: number;
  car: number;
  rushYds: number;
  att: number;
  passYds: number;
  passTd: number;
};

export type TeamGame = {
  gameId: string;
  season: number;
  week: number;
  team: string;
  opp: string;
  /** Points the market expects this team to score (total / 2 ± spread / 2). */
  implied: number | null;
  /** Points this team is favored by (negative = underdog). */
  spread: number | null;
  tgt: number;
  car: number;
  att: number;
};

const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'FB']);

/** Every QB/RB/WR/TE game of a regular season (players who took a snap), and every team game with its betting line. */
export function nflUsageData(season: number): Promise<{ players: UsageGame[]; teams: TeamGame[] }> {
  return cached(`nfl-usage-${season}`, async () => {
    const [weeks, games, snaps, xwalk] = await Promise.all([
      playerWeeks(season),
      schedule(season),
      snapCounts(season).catch(() => []),
      pfrToGsis(),
    ]);
    const reg = weeks.filter((w) => w.seasonType === 'REG' && POSITIONS.has(w.position));
    const info = new Map<string, { name: string; pos: PropPos }>();
    for (const w of reg) info.set(w.playerId, { name: w.name, pos: (w.position === 'FB' ? 'RB' : w.position) as PropPos });

    const rows = new Map<string, UsageGame>();
    const gameOf = new Map(games.filter((g) => g.gameType === 'REG').map((g) => [g.gameId, g]));
    const blank = (id: string, gameId: string, team: string, week: number): UsageGame | null => {
      const i = info.get(id);
      const g = gameOf.get(gameId);
      if (!i || !g) return null;
      return { id, name: i.name, pos: i.pos, team, opp: g.home === team ? g.away : g.home, gameId, season, week, snap: 0, tgt: 0, rec: 0, recYds: 0, car: 0, rushYds: 0, att: 0, passYds: 0, passTd: 0 };
    };
    for (const w of reg) {
      const r = blank(w.playerId, w.gameId, w.team, w.week);
      if (!r) continue;
      Object.assign(r, {
        tgt: Number(w.targets) || 0,
        rec: Number(w.receptions) || 0,
        recYds: Number(w.receiving_yards) || 0,
        car: Number(w.carries) || 0,
        rushYds: Number(w.rushing_yards) || 0,
        att: Number(w.attempts) || 0,
        passYds: Number(w.passing_yards) || 0,
        passTd: Number(w.passing_tds) || 0,
      });
      rows.set(`${w.gameId}|${w.playerId}`, r);
    }
    // Snap counts: who played (including games with no stats), and how much.
    for (const s of snaps) {
      if (s.gameType !== 'REG' || !s.offensePct) continue;
      const id = xwalk.get(s.pfrId);
      if (!id) continue;
      const k = `${s.gameId}|${id}`;
      const r = rows.get(k) ?? blank(id, s.gameId, s.team, s.week);
      if (!r) continue;
      r.snap = s.offensePct;
      rows.set(k, r);
    }
    // A player with stats but no snap row (snap data missing) still played.
    for (const r of rows.values()) if (!r.snap && (r.tgt || r.car || r.att)) r.snap = 0.5;

    const teamMap = new Map<string, TeamGame>();
    for (const g of gameOf.values()) {
      for (const [team, opp, home] of [[g.home, g.away, true], [g.away, g.home, false]] as const) {
        const spread = g.spreadLine == null ? null : home ? g.spreadLine : -g.spreadLine;
        const implied = g.totalLine == null || spread == null ? null : g.totalLine / 2 + spread / 2;
        teamMap.set(`${g.gameId}|${team}`, { gameId: g.gameId, season, week: g.week, team, opp, implied, spread, tgt: 0, car: 0, att: 0 });
      }
    }
    for (const r of rows.values()) {
      const t = teamMap.get(`${r.gameId}|${r.team}`);
      if (!t) continue;
      t.tgt += r.tgt;
      t.car += r.car;
      t.att += r.att;
    }
    return { players: [...rows.values()], teams: [...teamMap.values()] };
  });
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type UsageParams = {
  halfLife: number; // games: weight of a game halves every `halfLife` games back
  prevWeight: number; // last season's games count this much
  rho: number; // share of a missing teammate's targets/carries handed to those who play
  tdImplied: number; // exponent on (implied total / league average) for TD passes
  shrink: { cr: number; ypt: number; ypc: number; ypa: number; tdr: number }; // pseudo-counts toward position average
};

export const DEFAULT_PARAMS: UsageParams = { halfLife: 4, prevWeight: 0.5, rho: 0.8, tdImplied: 1, shrink: { cr: 30, ypt: 40, ypc: 50, ypa: 150, tdr: 300 } };

/** Linear model of team volume: [1, implied, spread, team avg so far, opponent allowed so far]. */
export type VolumeModel = Record<'tgt' | 'car' | 'att', number[]>;
export type PosMeans = Record<PropPos, { cr: number; ypt: number; ypc: number; ypa: number; tdr: number }>;

export const LEAGUE_IMPLIED = 22.5;

/** Team volume features from a team's and its opponent's earlier games (this season, else last season). */
export function volumeFeatures(
  t: Pick<TeamGame, 'team' | 'opp' | 'implied' | 'spread'>,
  prior: TeamGame[], // this season's earlier games, all teams
  prev: TeamGame[], // last season's games, all teams
  stat: 'tgt' | 'car' | 'att',
): number[] | null {
  if (t.implied == null || t.spread == null) return null;
  const avg = (gs: TeamGame[]) => (gs.length ? gs.reduce((a, g) => a + g[stat], 0) / gs.length : null);
  const own = prior.filter((g) => g.team === t.team);
  const against = prior.filter((g) => g.opp === t.opp);
  const league = avg(prev) ?? avg(prior) ?? 0;
  const teamAvg = own.length >= 2 ? avg(own)! : (avg(prev.filter((g) => g.team === t.team)) ?? league);
  const oppAvg = against.length >= 2 ? avg(against)! : (avg(prev.filter((g) => g.opp === t.opp)) ?? league);
  return [1, t.implied, t.spread, teamAvg, oppAvg];
}

/** Ordinary least squares via the normal equations (small, well-conditioned feature sets). */
export function ols(X: number[][], y: number[]): number[] {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i][j] += X[r][i] * X[r][j];
      A[i][k] += X[r][i] * y[r];
    }
  }
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

export const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Recency-weighted average of f over a player's earlier games (oldest first); prev-season games carry prevWeight. */
function ewma<T extends { season: number }>(games: T[], season: number, f: (g: T) => number | null, p: UsageParams): number | null {
  let num = 0, den = 0;
  for (let i = games.length - 1, age = 0; i >= 0; i--, age++) {
    const v = f(games[i]);
    if (v == null) continue;
    const w = 0.5 ** (age / p.halfLife) * (games[i].season === season ? 1 : p.prevWeight);
    num += w * v;
    den += w;
  }
  return den ? num / den : null;
}

export type Shares = { tgt: number; car: number; att: number };

/** A player's expected shares of team targets, carries and pass attempts, from his earlier games he played. */
export function playerShares(history: UsageGame[], teamOf: (g: UsageGame) => TeamGame | undefined, season: number, p: UsageParams): Shares | null {
  const played = history.filter((g) => g.snap > 0);
  if (!played.length) return null;
  const share = (k: 'tgt' | 'car' | 'att') => ewma(played, season, (g) => {
    const t = teamOf(g);
    return t && t[k] > 0 ? g[k] / t[k] : null;
  }, p) ?? 0;
  return { tgt: share('tgt'), car: share('car'), att: share('att') };
}

export type Projection = Partial<Record<PropStat, number>>;

/** Project one player's game from his shares (after teammate adjustments), team volume and efficiency. */
export function projectPlayer(
  pos: PropPos,
  history: UsageGame[],
  shares: Shares,
  volume: { tgt: number; car: number; att: number },
  implied: number,
  means: PosMeans,
  season: number,
  p: UsageParams,
): Projection {
  const m = means[pos];
  const w = (g: UsageGame) => (g.season === season ? 1 : p.prevWeight);
  const sum = (f: (g: UsageGame) => number) => history.reduce((a, g) => a + w(g) * f(g), 0);
  const tgtN = sum((g) => g.tgt), carN = sum((g) => g.car), attN = sum((g) => g.att);
  const cr = (sum((g) => g.rec) + p.shrink.cr * m.cr) / (tgtN + p.shrink.cr);
  const ypt = (sum((g) => g.recYds) + p.shrink.ypt * m.ypt) / (tgtN + p.shrink.ypt);
  const ypc = (sum((g) => g.rushYds) + p.shrink.ypc * m.ypc) / (carN + p.shrink.ypc);
  const ypa = (sum((g) => g.passYds) + p.shrink.ypa * m.ypa) / (attN + p.shrink.ypa);
  const tdr = (sum((g) => g.passTd) + p.shrink.tdr * m.tdr) / (attN + p.shrink.tdr);
  const targets = volume.tgt * shares.tgt;
  const carries = volume.car * shares.car;
  const attempts = volume.att * shares.att;
  const out: Projection = {
    targets,
    receptions: targets * cr,
    recYds: targets * ypt,
    carries,
    rushYds: carries * ypc,
  };
  if (pos === 'QB') {
    out.passAtt = attempts;
    out.passYds = attempts * ypa;
    out.passTd = attempts * tdr * (Math.max(10, implied) / LEAGUE_IMPLIED) ** p.tdImplied;
  }
  return out;
}

/**
 * Hand missing teammates' shares to those who play: each active player's share
 * rises by rho × (missing share) × (his share / active players' total share).
 */
export function redistribute(active: Map<string, Shares>, missing: Shares[], rho: number): Map<string, Shares> {
  const out = new Map<string, Shares>();
  for (const k of ['tgt', 'car'] as const) {
    const vac = missing.reduce((a, s) => a + s[k], 0);
    const tot = [...active.values()].reduce((a, s) => a + s[k], 0);
    for (const [id, s] of active) {
      const o = out.get(id) ?? { ...s };
      if (vac > 0 && tot > 0) o[k] = s[k] * (1 + (rho * vac) / Math.max(tot, 0.3));
      out.set(id, o);
    }
  }
  return out;
}

/** Position averages of efficiency, from a set of games. */
export function positionMeans(games: UsageGame[]): PosMeans {
  const out = {} as PosMeans;
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as PropPos[]) {
    const g = games.filter((x) => x.pos === pos);
    const s = (f: (x: UsageGame) => number) => g.reduce((a, x) => a + f(x), 0);
    const tgt = s((x) => x.tgt) || 1, car = s((x) => x.car) || 1, att = s((x) => x.att) || 1;
    out[pos] = { cr: s((x) => x.rec) / tgt, ypt: s((x) => x.recYds) / tgt, ypc: s((x) => x.rushYds) / car, ypa: s((x) => x.passYds) / att, tdr: s((x) => x.passTd) / att };
  }
  return out;
}

// ---------------------------------------------------------------------------
// This week's projections
// ---------------------------------------------------------------------------


type ModelFile = { params: UsageParams; volume: VolumeModel; means: PosMeans; spread: SpreadModel };
export const USAGE_MODEL = MODEL as unknown as ModelFile;
export const USAGE_MODEL_NAME = 'nfl-usage-1: team volume from implied total + spread, recency-weighted shares, shrunk efficiency; fit 2021-25';

/** Chance a usage projection finishes over a line, from the spread of actual / projection on 2021-2025. */
export const usageChanceOver = (pos: PropPos, stat: PropStat, proj: number, line: number) => spreadChance(USAGE_MODEL.spread, `${pos}|${stat}`, proj, line);
export const usageOutcomeAt = (pos: PropPos, stat: PropStat, proj: number, q: number) => spreadOutcome(USAGE_MODEL.spread, `${pos}|${stat}`, proj, q);

export type WeekPlayer = {
  id: string;
  name: string;
  pos: PropPos;
  team: string;
  injury: string | null; // Questionable etc. (players ruled out are dropped)
  shares: Shares;
  proj: Projection;
};
export type WeekGame = {
  gameId: string;
  week: number;
  gameday: string;
  gametime: string;
  away: string;
  home: string;
  total: number | null;
  spread: number | null; // home perspective
  sides: Array<{ team: string; implied: number | null; volume: { tgt: number; car: number; att: number } | null; out: string[]; players: WeekPlayer[] }>;
};

/**
 * Usage projections for every game from `asOf` (YYYY-MM-DD) through the rest of that week.
 * `starters`: name keys of the QBs expected to start (e.g. the QBs a sportsbook posts
 * passing props for); otherwise the active QB with the most recent attempts starts.
 */
export async function nflWeekProjections(season: number, asOf: string, opts: { starters?: Set<string> } = {}): Promise<WeekGame[]> {
  const p = USAGE_MODEL.params;
  const [cur, prev, sched, status] = await Promise.all([
    nflUsageData(season),
    nflUsageData(season - 1),
    schedule(season),
    nflPlayerStatus().catch(() => new Map<string, PlayerStatus>()),
  ]);
  const upcoming = sched.filter((g) => g.gameType === 'REG' && g.gameday >= asOf).sort((a, b) => a.gameday.localeCompare(b.gameday));
  if (!upcoming.length) return [];
  const week = upcoming[0].week;
  const games = upcoming.filter((g) => g.week === week);

  const teamIdx = new Map([...prev.teams, ...cur.teams].map((t) => [`${t.gameId}|${t.team}`, t]));
  const teamOf = (g: UsageGame) => teamIdx.get(`${g.gameId}|${g.team}`);
  const byPlayer = new Map<string, UsageGame[]>();
  for (const g of [...prev.players, ...cur.players.filter((x) => x.week < week)]) (byPlayer.get(g.id) ?? byPlayer.set(g.id, []).get(g.id)!).push(g);
  for (const l of byPlayer.values()) l.sort((a, b) => a.season - b.season || a.week - b.week);
  const prior = cur.teams.filter((t) => t.week < week && (t.att || t.car));
  // His team today: ESPN's roster; failing that, his team this season (not a team he left last year).
  const teamNow = (id: string) => {
    const st = status.get(id)?.team;
    if (st) return st;
    const last = byPlayer.get(id)?.at(-1);
    return last && last.season === season ? last.team : null;
  };

  const out: WeekGame[] = [];
  for (const g of games) {
    const sides: WeekGame['sides'] = [];
    for (const [team, opp, home] of [[g.away, g.home, false], [g.home, g.away, true]] as const) {
      const spread = g.spreadLine == null ? null : home ? g.spreadLine : -g.spreadLine;
      const implied = g.totalLine == null || spread == null ? null : g.totalLine / 2 + spread / 2;
      const vf = (['tgt', 'car', 'att'] as const).map((k) => volumeFeatures({ team, opp, implied, spread }, prior, prev.teams, k));
      const volume = vf.every(Boolean) ? { tgt: dot(USAGE_MODEL.volume.tgt, vf[0]!), car: dot(USAGE_MODEL.volume.car, vf[1]!), att: dot(USAGE_MODEL.volume.att, vf[2]!) } : null;

      const recentWeeks = prior.filter((t) => t.team === team).map((t) => t.week).sort((a, b) => b - a).slice(0, 3);
      const recentCount = new Map<string, number>();
      for (const x of cur.players) if (x.team === team && recentWeeks.includes(x.week) && x.snap > 0) recentCount.set(x.id, (recentCount.get(x.id) ?? 0) + 1);
      const regulars = [...recentCount].filter(([, n]) => n >= Math.min(2, recentWeeks.length)).map(([id]) => id);
      // Everyone who could play for this team today: on its roster (ESPN) or, failing that, last seen there.
      const candidates = [...byPlayer.keys()].filter((id) => teamNow(id) === team);
      const ruledOut = (id: string) => isOut(status.get(id)?.injury?.status);
      const activeIds = candidates.filter((id) => !ruledOut(id));
      const missingIds = regulars.filter((id) => ruledOut(id) || teamNow(id) !== team);
      const shares = new Map<string, Shares>();
      for (const id of activeIds) {
        const sh = playerShares(byPlayer.get(id)!, teamOf, season, p);
        if (sh && (sh.tgt > 0.02 || sh.car > 0.02 || sh.att > 0.2)) shares.set(id, sh);
      }
      const missing = missingIds
        .map((id) => playerShares(byPlayer.get(id)!.filter((x) => x.season === season && x.team === team), teamOf, season, p))
        .filter((sh): sh is Shares => !!sh)
        .map((sh) => ({ tgt: sh.tgt >= 0.1 ? sh.tgt : 0, car: sh.car >= 0.1 ? sh.car : 0, att: 0 }));
      const adj = redistribute(shares, missing, p.rho);
      // One starting QB: the active QB with the largest share of attempts takes them all.
      const named = (id: string) => (opts.starters?.has(nameKey(byPlayer.get(id)!.at(-1)!.name)) ? 1 : 0);
      const qbs = [...adj].filter(([id]) => byPlayer.get(id)!.at(-1)!.pos === 'QB').sort((a, b) => named(b[0]) - named(a[0]) || b[1].att - a[1].att);
      for (const [i, [id, sh]] of qbs.entries()) adj.set(id, { ...sh, att: i === 0 ? Math.max(sh.att, 0.97) : 0 });

      const players: WeekPlayer[] = [];
      for (const [id, sh] of adj) {
        const h = byPlayer.get(id)!;
        const last = h.at(-1)!;
        if (!volume || implied == null) continue;
        if (last.pos === 'QB' && sh.att === 0) continue;
        const proj = projectPlayer(last.pos, h, sh, volume, implied, USAGE_MODEL.means, season, p);
        const kept: Projection = {};
        for (const st of POS_STATS[last.pos]) if (proj[st] != null) kept[st] = proj[st];
        players.push({ id, name: last.name, pos: last.pos, team, injury: status.get(id)?.injury?.status ?? null, shares: sh, proj: kept });
      }
      const name = (id: string) => byPlayer.get(id)?.at(-1)?.name ?? id;
      sides.push({ team, implied, volume, out: missingIds.map(name), players });
    }
    out.push({ gameId: g.gameId, week, gameday: g.gameday, gametime: g.gametime, away: g.away, home: g.home, total: g.totalLine, spread: g.spreadLine, sides });
  }
  return out;
}
