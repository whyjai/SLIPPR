/**
 * NFL player-prop research: what each defense allows against the run and the
 * pass (by position), and a projection for each prop stat that starts from the
 * player's own average and adjusts for the opponent by amounts measured out of
 * sample (scripts/research/audit-nfl-props.mts: fit on one season, tested on
 * the next, using only games before each week).
 */
import { loadPlays, type Play } from './nfl-pbp';
import { cached } from './csv';
import { getNflPlayerTrends } from './nfl-players';
import { playerWeeks, schedule, TEAM_NAMES, type PlayerWeek } from './nflverse';

export type PropPos = 'QB' | 'RB' | 'WR' | 'TE';
export type PropStat = 'passYds' | 'passAtt' | 'passTd' | 'rushYds' | 'carries' | 'recYds' | 'receptions' | 'targets';

export const STAT_COL: Record<PropStat, string> = {
  passYds: 'passing_yards',
  passAtt: 'attempts',
  passTd: 'passing_tds',
  rushYds: 'rushing_yards',
  carries: 'carries',
  recYds: 'receiving_yards',
  receptions: 'receptions',
  targets: 'targets',
};

export const STAT_LABEL: Record<PropStat, string> = {
  passYds: 'Pass yds',
  passAtt: 'Pass att',
  passTd: 'Pass TD',
  rushYds: 'Rush yds',
  carries: 'Carries',
  recYds: 'Rec yds',
  receptions: 'Receptions',
  targets: 'Targets',
};

/** Prop stats worth a line, per position. */
export const POS_STATS: Record<PropPos, PropStat[]> = {
  QB: ['passYds', 'passAtt', 'passTd', 'rushYds'],
  RB: ['rushYds', 'carries', 'recYds', 'receptions'],
  WR: ['recYds', 'receptions', 'targets'],
  TE: ['recYds', 'receptions', 'targets'],
};

/**
 * A stat counts as a prop (and the calibrated chances apply) only when the
 * player's baseline is at least this; the audit used the same cut.
 */
export const MIN_BASE: Record<PropStat, number> = { passYds: 150, passAtt: 20, passTd: 0.8, rushYds: 25, carries: 6, recYds: 25, receptions: 2, targets: 3 };
export const MIN_BASE_POS: Partial<Record<PropPos, Partial<Record<PropStat, number>>>> = { QB: { rushYds: 10 }, RB: { recYds: 10, receptions: 1.5 } };
export const minBase = (pos: PropPos, stat: PropStat) => MIN_BASE_POS[pos]?.[stat] ?? MIN_BASE[stat];

export const posOf = (p: string): PropPos | null => (p === 'FB' ? 'RB' : p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE' ? p : null);

// ---------------------------------------------------------------------------
// Defense features, from games before a given week
// ---------------------------------------------------------------------------

/** One defense's per-game play counts (from play-by-play). */
export type DefGame = { team: string; week: number; gameId: string; dropbacks: number; dbEpa: number; dbYards: number; rushes: number; rushEpa: number; rushYards: number };

export function defenseGames(plays: Play[]): DefGame[] {
  const by = new Map<string, DefGame>();
  for (const p of plays) {
    const k = `${p.gameId}|${p.defense}`;
    const g = by.get(k) ?? { team: p.defense, week: p.week, gameId: p.gameId, dropbacks: 0, dbEpa: 0, dbYards: 0, rushes: 0, rushEpa: 0, rushYards: 0 };
    if (p.dropback) {
      g.dropbacks++;
      g.dbEpa += p.epa;
      g.dbYards += p.yards;
    } else {
      g.rushes++;
      g.rushEpa += p.epa;
      g.rushYards += p.yards;
    }
    by.set(k, g);
  }
  return [...by.values()];
}

export function nflDefenseGames(season: number): Promise<DefGame[]> {
  return cached(`nfl-defgames-${season}`, async () => defenseGames(await loadPlays(season)));
}

/** Feature names, all "allowed / faced by this defense, per game or per play". */
export type Feature =
  | 'allowedQB_passYds' | 'allowedQB_passAtt' | 'allowedQB_passTd' | 'allowedQB_rushYds'
  | 'allowedRB_rushYds' | 'allowedRB_carries' | 'allowedRB_recYds' | 'allowedRB_receptions'
  | 'allowedWR_recYds' | 'allowedWR_receptions' | 'allowedWR_targets'
  | 'allowedTE_recYds' | 'allowedTE_receptions' | 'allowedTE_targets'
  | 'epaPerDropback' | 'yardsPerDropback' | 'dropbacksFaced'
  | 'epaPerRush' | 'yardsPerRush' | 'rushesFaced' | 'passRateFaced';

export type DefenseProfile = { team: string; games: number; values: Record<Feature, number> };

/**
 * Each defense's profile from its games with week < `beforeWeek` (or all games).
 * Box-score "allowed to position" plus play-by-play efficiency and volume.
 */
export function defenseProfiles(weeks: PlayerWeek[], defGames: DefGame[], beforeWeek = Infinity): Map<string, DefenseProfile> {
  const sums = new Map<string, Record<string, number>>();
  const games = new Map<string, Set<string>>();
  for (const w of weeks) {
    if (w.seasonType !== 'REG' || w.week >= beforeWeek || !w.opponent) continue;
    const pos = posOf(w.position);
    (games.get(w.opponent) ?? games.set(w.opponent, new Set()).get(w.opponent)!).add(w.gameId);
    if (!pos) continue;
    const s = sums.get(w.opponent) ?? {};
    for (const stat of POS_STATS[pos]) s[`allowed${pos}_${stat}`] = (s[`allowed${pos}_${stat}`] ?? 0) + Number(w[STAT_COL[stat]] ?? 0);
    sums.set(w.opponent, s);
  }
  const pbp = new Map<string, DefGame>();
  for (const g of defGames) {
    if (g.week >= beforeWeek) continue;
    const t = pbp.get(g.team) ?? { ...g, dropbacks: 0, dbEpa: 0, dbYards: 0, rushes: 0, rushEpa: 0, rushYards: 0 };
    t.dropbacks += g.dropbacks;
    t.dbEpa += g.dbEpa;
    t.dbYards += g.dbYards;
    t.rushes += g.rushes;
    t.rushEpa += g.rushEpa;
    t.rushYards += g.rushYards;
    pbp.set(g.team, t);
  }
  const out = new Map<string, DefenseProfile>();
  for (const [team, gs] of games) {
    const n = gs.size;
    const s = sums.get(team) ?? {};
    const p = pbp.get(team);
    const values = {} as Record<Feature, number>;
    for (const pos of ['QB', 'RB', 'WR', 'TE'] as PropPos[]) {
      for (const stat of POS_STATS[pos]) values[`allowed${pos}_${stat}` as Feature] = (s[`allowed${pos}_${stat}`] ?? 0) / n;
    }
    values.epaPerDropback = p?.dropbacks ? p.dbEpa / p.dropbacks : 0;
    values.yardsPerDropback = p?.dropbacks ? p.dbYards / p.dropbacks : 0;
    values.dropbacksFaced = p ? p.dropbacks / n : 0;
    values.epaPerRush = p?.rushes ? p.rushEpa / p.rushes : 0;
    values.yardsPerRush = p?.rushes ? p.rushYards / p.rushes : 0;
    values.rushesFaced = p ? p.rushes / n : 0;
    values.passRateFaced = p && p.dropbacks + p.rushes ? p.dropbacks / (p.dropbacks + p.rushes) : 0;
    out.set(team, { team, games: n, values });
  }
  return out;
}

/** z-scores of every feature across the defenses in a profile map. */
export function zScores(profiles: Map<string, DefenseProfile>): Map<string, Record<Feature, number>> {
  const list = [...profiles.values()];
  const feats = Object.keys(list[0]?.values ?? {}) as Feature[];
  const stats = Object.fromEntries(
    feats.map((f) => {
      const xs = list.map((p) => p.values[f]);
      const m = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length || 1)) || 1;
      return [f, { m, sd }];
    }),
  ) as Record<Feature, { m: number; sd: number }>;
  return new Map(list.map((p) => [p.team, Object.fromEntries(feats.map((f) => [f, (p.values[f] - stats[f].m) / stats[f].sd])) as Record<Feature, number>]));
}

// ---------------------------------------------------------------------------
// Projection model
// ---------------------------------------------------------------------------

/** Which defensive features each prop is regressed on (run vs pass defense by position). */
export const PROP_FEATURES: Record<PropPos, Partial<Record<PropStat, Feature[]>>> = {
  QB: {
    passYds: ['allowedQB_passYds', 'epaPerDropback', 'dropbacksFaced'],
    passAtt: ['allowedQB_passAtt', 'dropbacksFaced', 'passRateFaced'],
    passTd: ['allowedQB_passTd', 'epaPerDropback'],
    rushYds: ['allowedQB_rushYds', 'yardsPerRush'],
  },
  RB: {
    rushYds: ['allowedRB_rushYds', 'yardsPerRush', 'epaPerRush', 'rushesFaced'],
    carries: ['allowedRB_carries', 'rushesFaced', 'passRateFaced'],
    recYds: ['allowedRB_recYds', 'yardsPerDropback'],
    receptions: ['allowedRB_receptions', 'dropbacksFaced'],
  },
  WR: {
    recYds: ['allowedWR_recYds', 'yardsPerDropback', 'dropbacksFaced'],
    receptions: ['allowedWR_receptions', 'dropbacksFaced'],
    targets: ['allowedWR_targets', 'dropbacksFaced', 'passRateFaced'],
  },
  TE: {
    recYds: ['allowedTE_recYds', 'yardsPerDropback'],
    receptions: ['allowedTE_receptions', 'dropbacksFaced'],
    targets: ['allowedTE_targets', 'dropbacksFaced'],
  },
};

/**
 * Fractional change in a player's line per +1 SD of each feature (PROP_FEATURES
 * order). audit-nfl-props.mts fit these on 2023 and 2024 and tested each on the
 * following season, using only earlier weeks. Only effects that helped in both
 * tests are kept (the smaller of the two fits): RB receiving rises against
 * defenses that give up more yards per dropback and face more passing. Run
 * defense vs RB rushing, and pass defense vs QB/WR/TE, flipped sign between
 * seasons and didn't improve projections, so they're shown as context only.
 */
export const PROP_EFFECTS: Record<PropPos, Partial<Record<PropStat, number[]>>> = {
  QB: {},
  RB: { recYds: [0, 0.069], receptions: [0, 0.072] },
  WR: {},
  TE: {},
};

/** Weight on the last 3 games vs the season so far; best in both audit tests (0.25). */
export const RECENT_WEIGHT = 0.25;

/**
 * The spread of outcomes: quantiles (0, 5%, ..., 100%) of actual / baseline per
 * prop, from 2024. Checked on 2025, "X% chance over" landed within ~3 points
 * (said 25 → 23, 55 → 52, 74 → 74). Medians sit below 1 for yardage: a typical
 * game is under the average (RB rush yds ~0.86x, WR rec yds ~0.90x).
 */
export const RATIO_QUANTILES: Record<PropPos, Partial<Record<PropStat, number[]>>> = {"QB": {"passYds": [0, 0.449, 0.59, 0.648, 0.709, 0.772, 0.83, 0.872, 0.928, 0.967, 1.014, 1.051, 1.105, 1.152, 1.193, 1.232, 1.298, 1.362, 1.46, 1.634, 2.937], "passAtt": [0, 0.503, 0.636, 0.737, 0.786, 0.829, 0.862, 0.904, 0.936, 0.978, 1.02, 1.058, 1.112, 1.141, 1.181, 1.22, 1.271, 1.332, 1.386, 1.539, 2.239], "passTd": [0, 0, 0, 0, 0, 0.486, 0.6, 0.712, 0.787, 0.88, 1, 1.103, 1.175, 1.297, 1.465, 1.6, 1.806, 2, 2.278, 2.783, 4.414], "rushYds": [-0.69, 0, 0, 0.107, 0.203, 0.321, 0.418, 0.495, 0.583, 0.652, 0.751, 0.828, 0.946, 1.072, 1.278, 1.458, 1.67, 1.915, 2.273, 2.635, 4.681]}, "RB": {"rushYds": [-0.061, 0.071, 0.202, 0.298, 0.403, 0.485, 0.54, 0.597, 0.683, 0.78, 0.862, 0.94, 1.036, 1.13, 1.209, 1.324, 1.437, 1.596, 1.785, 2.193, 3.487], "carries": [0, 0.231, 0.342, 0.444, 0.563, 0.646, 0.698, 0.752, 0.832, 0.891, 0.944, 1, 1.056, 1.137, 1.217, 1.28, 1.364, 1.455, 1.567, 1.795, 3.525], "recYds": [-0.913, 0, 0, 0, 0, 0.167, 0.252, 0.332, 0.427, 0.559, 0.636, 0.75, 0.899, 1.078, 1.245, 1.399, 1.551, 1.846, 2.222, 3.052, 7.797], "receptions": [0, 0, 0, 0.276, 0.372, 0.421, 0.522, 0.6, 0.671, 0.75, 0.823, 0.92, 1, 1.122, 1.251, 1.371, 1.5, 1.699, 1.866, 2.308, 4.324]}, "WR": {"recYds": [-0.095, 0, 0.176, 0.272, 0.372, 0.452, 0.545, 0.64, 0.727, 0.826, 0.902, 0.981, 1.088, 1.195, 1.305, 1.405, 1.566, 1.729, 2.011, 2.433, 4.977], "receptions": [0, 0, 0.281, 0.386, 0.457, 0.544, 0.64, 0.732, 0.794, 0.857, 0.93, 0.984, 1.084, 1.159, 1.274, 1.371, 1.5, 1.646, 1.888, 2.161, 3.9], "targets": [0, 0.246, 0.333, 0.471, 0.564, 0.632, 0.704, 0.773, 0.838, 0.893, 0.96, 1.014, 1.076, 1.143, 1.224, 1.329, 1.455, 1.605, 1.767, 2.034, 4.333]}, "TE": {"recYds": [-0.173, 0, 0.189, 0.294, 0.44, 0.501, 0.59, 0.652, 0.748, 0.818, 0.926, 1.021, 1.134, 1.238, 1.361, 1.494, 1.694, 1.807, 2.041, 2.4, 3.542], "receptions": [0, 0, 0.261, 0.391, 0.471, 0.526, 0.6, 0.698, 0.787, 0.874, 0.97, 1.055, 1.14, 1.235, 1.371, 1.5, 1.6, 1.721, 1.911, 2.25, 4.174], "targets": [0, 0.25, 0.329, 0.454, 0.519, 0.59, 0.675, 0.766, 0.828, 0.932, 0.988, 1.059, 1.171, 1.241, 1.333, 1.443, 1.527, 1.693, 1.868, 2.118, 3.75]}};

const QS = Array.from({ length: 21 }, (_, i) => i / 20);

/** Chance the stat finishes over `line`, given the player's baseline (from RATIO_QUANTILES). */
export function chanceOver(pos: PropPos, stat: PropStat, base: number, line: number, adj = 0): number | null {
  const qs = RATIO_QUANTILES[pos][stat];
  if (!qs || base <= 0) return null;
  const x = line / (base * (1 + adj));
  if (x <= qs[0]) return 1;
  if (x >= qs[qs.length - 1]) return 0;
  for (let i = 1; i < qs.length; i++) {
    if (x <= qs[i]) {
      const span = qs[i] - qs[i - 1];
      const f = span ? (x - qs[i - 1]) / span : 0;
      return 1 - (QS[i - 1] + f * (QS[i] - QS[i - 1]));
    }
  }
  return 0;
}

/** Value at quantile q (0-1) of the outcome spread. */
export function outcomeAt(pos: PropPos, stat: PropStat, base: number, q: number, adj = 0): number | null {
  const qs = RATIO_QUANTILES[pos][stat];
  if (!qs) return null;
  return base * (1 + adj) * qs[Math.round(q * 20)];
}

/** Player's baseline for a stat from his earlier games (blend chosen by the audit). */
export function baseline(values: number[], recentWeight = RECENT_WEIGHT): number | null {
  if (values.length < 3) return null;
  const season = values.reduce((a, b) => a + b, 0) / values.length;
  const last = values.slice(-3);
  const recent = last.reduce((a, b) => a + b, 0) / last.length;
  return (1 - recentWeight) * season + recentWeight * recent;
}

export function adjustment(pos: PropPos, stat: PropStat, z: Record<Feature, number> | undefined, effects = PROP_EFFECTS): number {
  const coef = effects[pos][stat];
  const feats = PROP_FEATURES[pos][stat];
  if (!coef || !feats || !z) return 0;
  return feats.reduce((a, f, i) => a + (coef[i] ?? 0) * (z[f] ?? 0), 0);
}

// ---------------------------------------------------------------------------
// This week's cheat sheet
// ---------------------------------------------------------------------------

export type RankedValue = { value: number; rank: number }; // rank 1 = allows the most / faces the most

export type DefenseContext = {
  team: string;
  games: number;
  run: { rbRushYds: RankedValue; rbCarries: RankedValue; yardsPerRush: RankedValue; epaPerRush: RankedValue; rushesFaced: RankedValue };
  pass: {
    qbPassYds: RankedValue;
    epaPerDropback: RankedValue;
    yardsPerDropback: RankedValue;
    dropbacksFaced: RankedValue;
    wrRecYds: RankedValue;
    teRecYds: RankedValue;
    rbRecYds: RankedValue;
  };
  /** Share of plays opponents pass against them, and where that ranks (1 = most passed against). */
  passRateFaced: RankedValue;
  funnel: 'pass' | 'run' | null;
};

export type PropLine = {
  stat: PropStat;
  label: string;
  season: number;
  last3: number;
  projection: number; // baseline (season, 25% weight on last 3) × matchup adjustment
  adjPct: number; // matchup adjustment in %, 0 where the audit found none
  median: number;
  low: number; // 25th percentile outcome
  high: number; // 75th percentile outcome
  /** Lines around the median: chance over (from the calibrated spread) and his own hit rate this season. */
  lines: Array<{ line: number; chance: number; hits: number; games: number }>;
};

export type PropPlayer = {
  id: string;
  name: string;
  pos: PropPos;
  team: string;
  games: number;
  snapPct: number | null; // last 3 games
  share: number | null; // target share %, last 3 (not for QBs)
  missedLast: boolean; // didn't play the team's most recent game
  props: PropLine[];
};

export type PropGame = {
  gameId: string;
  kickoff: string;
  away: string;
  home: string;
  sides: Array<{ offense: string; defense: DefenseContext; players: PropPlayer[] }>;
};

export type NflPropSheet = {
  season: number;
  week: number | null;
  throughWeek: number;
  generatedAt: string;
  games: PropGame[];
};

const STEP: Record<PropStat, number> = { passYds: 15, passAtt: 3, passTd: 1, rushYds: 10, carries: 2, recYds: 10, receptions: 1, targets: 1 };
const r1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function rankMap(profiles: DefenseProfile[], f: Feature): Map<string, RankedValue> {
  const sorted = [...profiles].sort((a, b) => b.values[f] - a.values[f]);
  return new Map(sorted.map((p, i) => [p.team, { value: Math.round(p.values[f] * 1000) / 1000, rank: i + 1 }]));
}

export async function getNflPropSheet(season: number): Promise<NflPropSheet> {
  const [weeks, games, defGames, trends] = await Promise.all([
    playerWeeks(season),
    schedule(season),
    nflDefenseGames(season),
    getNflPlayerTrends(season),
  ]);
  const reg = weeks.filter((w) => w.seasonType === 'REG');
  const throughWeek = Math.max(0, ...reg.map((w) => w.week));
  const open = games.filter((g) => g.gameType === 'REG' && g.homeScore == null);
  const week = open.length ? Math.min(...open.map((g) => g.week)) : null;
  const slate = open.filter((g) => g.week === week).sort((a, b) => `${a.gameday} ${a.gametime}`.localeCompare(`${b.gameday} ${b.gametime}`));

  const profiles = defenseProfiles(reg, defGames);
  const z = zScores(profiles);
  const list = [...profiles.values()];
  const ranks = Object.fromEntries(
    (Object.keys(list[0]?.values ?? {}) as Feature[]).map((f) => [f, rankMap(list, f)]),
  ) as Record<Feature, Map<string, RankedValue>>;
  const n = list.length;
  const context = (team: string): DefenseContext => {
    const g = (f: Feature) => ranks[f].get(team) ?? { value: 0, rank: 0 };
    const pr = g('passRateFaced');
    return {
      team,
      games: profiles.get(team)?.games ?? 0,
      run: { rbRushYds: g('allowedRB_rushYds'), rbCarries: g('allowedRB_carries'), yardsPerRush: g('yardsPerRush'), epaPerRush: g('epaPerRush'), rushesFaced: g('rushesFaced') },
      pass: {
        qbPassYds: g('allowedQB_passYds'),
        epaPerDropback: g('epaPerDropback'),
        yardsPerDropback: g('yardsPerDropback'),
        dropbacksFaced: g('dropbacksFaced'),
        wrRecYds: g('allowedWR_recYds'),
        teRecYds: g('allowedTE_recYds'),
        rbRecYds: g('allowedRB_recYds'),
      },
      passRateFaced: pr,
      funnel: pr.rank && pr.rank <= 8 ? 'pass' : pr.rank && pr.rank > n - 8 ? 'run' : null,
    };
  };

  // Usage (snap %, target share) from the player-trends log.
  const usage = new Map(trends.players.map((p) => [p.id, p]));
  const byPlayer = new Map<string, PlayerWeek[]>();
  for (const w of reg) byPlayer.set(w.playerId, [...(byPlayer.get(w.playerId) ?? []), w]);
  for (const l of byPlayer.values()) l.sort((a, b) => a.week - b.week);
  const lastTeamWeek = new Map<string, number>();
  for (const w of reg) lastTeamWeek.set(w.team, Math.max(lastTeamWeek.get(w.team) ?? 0, w.week));

  const playersFor = (team: string, opp: string): PropPlayer[] => {
    const lastWeek = lastTeamWeek.get(team) ?? 0;
    const recent = (l: PlayerWeek[], k: string) => avg(l.filter((w) => w.week > lastWeek - 3).map((w) => Number(w[k] ?? 0)));
    const roster = [...byPlayer.values()].filter((l) => l[l.length - 1].team === team && l.length >= 3);
    const pick = (pos: PropPos, n: number, key: (l: PlayerWeek[]) => number) =>
      roster
        .filter((l) => posOf(l[l.length - 1].position) === pos)
        .sort((a, b) => key(b) - key(a))
        .slice(0, n);
    const chosen = [
      ...pick('QB', 1, (l) => recent(l, 'attempts')),
      ...pick('RB', 2, (l) => recent(l, 'carries') + recent(l, 'targets')),
      ...pick('WR', 3, (l) => recent(l, 'targets')),
      ...pick('TE', 1, (l) => recent(l, 'targets')),
    ];
    return chosen.map((l) => {
      const last = l[l.length - 1];
      const pos = posOf(last.position)!;
      const u = usage.get(last.playerId);
      const log3 = u?.log.filter((g) => g.season === season).slice(0, 3) ?? [];
      const props: PropLine[] = [];
      for (const stat of POS_STATS[pos]) {
        const values = l.map((w) => Number(w[STAT_COL[stat]] ?? 0));
        const base = baseline(values);
        if (base == null || base < minBase(pos, stat)) continue;
        const adj = adjustment(pos, stat, z.get(opp));
        const median = outcomeAt(pos, stat, base, 0.5, adj) ?? base;
        const step = STEP[stat];
        const mid = stat === 'passTd' ? 1.5 : Math.max(step / 2, Math.round(median / step) * step) - 0.5;
        const lines = [mid - step, mid, mid + step]
          .filter((x) => x > 0)
          .map((line) => ({
            line,
            chance: Math.round(100 * (chanceOver(pos, stat, base, line, adj) ?? 0)),
            hits: values.filter((v) => v > line).length,
            games: values.length,
          }));
        props.push({
          stat,
          label: STAT_LABEL[stat],
          season: r1(avg(values)),
          last3: r1(avg(values.slice(-3))),
          projection: r1(base * (1 + adj)),
          adjPct: r1(100 * adj),
          median: r1(median),
          low: r1(outcomeAt(pos, stat, base, 0.25, adj) ?? base),
          high: r1(outcomeAt(pos, stat, base, 0.75, adj) ?? base),
          lines,
        });
      }
      return {
        id: last.playerId,
        name: last.name,
        pos,
        team,
        games: l.length,
        snapPct: log3.length && log3.some((g) => g.snapPct != null) ? Math.round(avg(log3.filter((g) => g.snapPct != null).map((g) => g.snapPct!))) : null,
        share: pos !== 'QB' && log3.length ? r1(avg(log3.map((g) => g.targetShare))) : null,
        missedLast: last.week < lastWeek,
        props,
      };
    }).filter((p) => p.props.length > 0);
  };

  return {
    season,
    week,
    throughWeek,
    generatedAt: new Date().toISOString(),
    games: slate
      .filter((g) => TEAM_NAMES[g.home] && TEAM_NAMES[g.away])
      .map((g) => ({
        gameId: g.gameId,
        kickoff: `${g.gameday} ${g.gametime}`,
        away: g.away,
        home: g.home,
        sides: [
          { offense: g.away, defense: context(g.home), players: playersFor(g.away, g.home) },
          { offense: g.home, defense: context(g.away), players: playersFor(g.home, g.away) },
        ],
      })),
  };
}
