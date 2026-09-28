import { nickname, playerWeeks, schedule, TEAM_NAMES, type Game, type PlayerWeek } from './nflverse';
import { schemeNotesFor, type SchemeNote } from './nfl-teams';

/**
 * Defense vs. position: what each defense has allowed, per game, to opposing
 * QBs / RBs / WRs / TEs, ranked 1–32 where #1 = allowed the MOST (softest
 * matchup for that position) and #32 = allowed the fewest.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE';
export const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

export type MetricDef = {
  key: string;
  label: string;
  short: string;
  phrase: string;
};

const RECEIVING: MetricDef[] = [
  {
    key: 'receptions',
    label: 'Receptions',
    short: 'rec',
    phrase: 'receptions',
  },
  { key: 'targets', label: 'Targets', short: 'tgt', phrase: 'targets' },
  {
    key: 'receiving_yards',
    label: 'Receiving yards',
    short: 'rec yds',
    phrase: 'receiving yards',
  },
  {
    key: 'receiving_tds',
    label: 'Receiving TDs',
    short: 'rec TD',
    phrase: 'receiving TDs',
  },
];

export const METRICS: Record<Position, MetricDef[]> = {
  QB: [
    {
      key: 'fantasy_points_ppr',
      label: 'Fantasy points (PPR)',
      short: 'fpts',
      phrase: 'fantasy points (PPR)',
    },
    {
      key: 'passing_yards',
      label: 'Passing yards',
      short: 'pass yds',
      phrase: 'passing yards',
    },
    {
      key: 'passing_tds',
      label: 'Passing TDs',
      short: 'pass TD',
      phrase: 'passing TDs',
    },
    {
      key: 'completions',
      label: 'Completions',
      short: 'comp',
      phrase: 'completions',
    },
    {
      key: 'rushing_yards',
      label: 'Rushing yards',
      short: 'rush yds',
      phrase: 'rushing yards',
    },
  ],
  RB: [
    {
      key: 'fantasy_points_ppr',
      label: 'Fantasy points (PPR)',
      short: 'fpts',
      phrase: 'fantasy points (PPR)',
    },
    {
      key: 'rushing_yards',
      label: 'Rushing yards',
      short: 'rush yds',
      phrase: 'rushing yards',
    },
    { key: 'carries', label: 'Carries', short: 'car', phrase: 'carries' },
    {
      key: 'rushing_tds',
      label: 'Rushing TDs',
      short: 'rush TD',
      phrase: 'rushing TDs',
    },
    {
      key: 'receptions',
      label: 'Receptions',
      short: 'rec',
      phrase: 'receptions',
    },
    {
      key: 'receiving_yards',
      label: 'Receiving yards',
      short: 'rec yds',
      phrase: 'receiving yards',
    },
  ],
  WR: [
    {
      key: 'fantasy_points_ppr',
      label: 'Fantasy points (PPR)',
      short: 'fpts',
      phrase: 'fantasy points (PPR)',
    },
    ...RECEIVING,
  ],
  TE: [
    {
      key: 'fantasy_points_ppr',
      label: 'Fantasy points (PPR)',
      short: 'fpts',
      phrase: 'fantasy points (PPR)',
    },
    ...RECEIVING,
  ],
};

/** Metrics worth a matchup note (concrete stats first; fantasy points last). */
const NOTE_METRICS: Record<Position, string[]> = {
  QB: ['passing_yards', 'passing_tds', 'fantasy_points_ppr'],
  RB: ['rushing_yards', 'receptions', 'fantasy_points_ppr'],
  WR: ['receptions', 'receiving_yards', 'fantasy_points_ppr'],
  TE: ['receptions', 'receiving_yards', 'fantasy_points_ppr'],
};

export type StatCell = { perGame: number; rank: number };

export type DefenseRow = {
  team: string;
  name: string;
  games: number;
  stats: Record<Position, Record<string, StatCell>>;
};

export type MatchupNote = {
  defense: string;
  offense: string;
  position: Position;
  metric: string;
  metricLabel: string;
  rank: number;
  perGame: number;
  leagueAvg: number;
  direction: 'most' | 'fewest';
  defenseGames: number;
  player: { name: string; perGame: number; games: number } | null;
  text: string;
};

export type MatchupGame = {
  gameId: string;
  away: string;
  home: string;
  kickoff: string; // "2026-09-27 13:00" (ET)
  notes: MatchupNote[];
  /** How the defense lines up (blitz, box, coverage) × how the opposing player fares against it. */
  schemeNotes: SchemeNote[];
};

export type NflResearch = {
  season: number;
  generatedAt: string;
  weeksCovered: number[];
  /** Last week with every regular-season game final, and how many games of the next week are already in. */
  completedWeek: number;
  partialGames: number;
  upcomingWeek: number | null;
  defense: DefenseRow[];
  leagueAvg: Record<Position, Record<string, number>>;
  matchups: MatchupGame[];
  metrics: Record<Position, MetricDef[]>;
};

function positionGroup(pos: string): Position | null {
  if (pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE') return pos;
  if (pos === 'FB') return 'RB';
  return null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function computeDefense(weeks: PlayerWeek[]) {
  const reg = weeks.filter((w) => w.seasonType === 'REG');
  const gamesByDefense = new Map<string, Set<string>>();
  const totals = new Map<string, Record<Position, Record<string, number>>>();

  for (const w of reg) {
    if (!w.opponent) continue;
    if (!gamesByDefense.has(w.opponent)) gamesByDefense.set(w.opponent, new Set());
    gamesByDefense.get(w.opponent)!.add(w.gameId);
    const pos = positionGroup(w.position);
    if (!pos) continue;
    if (!totals.has(w.opponent)) totals.set(w.opponent, { QB: {}, RB: {}, WR: {}, TE: {} });
    const t = totals.get(w.opponent)![pos];
    for (const m of METRICS[pos]) t[m.key] = (t[m.key] ?? 0) + Number(w[m.key] ?? 0);
  }

  const teams = [...gamesByDefense.keys()].filter((t) => TEAM_NAMES[t]);
  const rows: DefenseRow[] = teams.map((team) => {
    const games = gamesByDefense.get(team)!.size;
    const stats = { QB: {}, RB: {}, WR: {}, TE: {} } as DefenseRow['stats'];
    for (const pos of POSITIONS) {
      for (const m of METRICS[pos]) {
        stats[pos][m.key] = {
          perGame: (totals.get(team)?.[pos][m.key] ?? 0) / games,
          rank: 0,
        };
      }
    }
    return {
      team,
      name: `${TEAM_NAMES[team].city} ${TEAM_NAMES[team].nickname}`,
      games,
      stats,
    };
  });

  const leagueAvg = {
    QB: {},
    RB: {},
    WR: {},
    TE: {},
  } as NflResearch['leagueAvg'];
  for (const pos of POSITIONS) {
    for (const m of METRICS[pos]) {
      const sorted = [...rows].sort((a, b) => b.stats[pos][m.key].perGame - a.stats[pos][m.key].perGame);
      sorted.forEach((r, i) => {
        const prev = sorted[i - 1];
        const cell = r.stats[pos][m.key];
        // competition ranking: ties share the better rank
        cell.rank = prev && prev.stats[pos][m.key].perGame === cell.perGame ? prev.stats[pos][m.key].rank : i + 1;
      });
      leagueAvg[pos][m.key] = round1(rows.reduce((s, r) => s + r.stats[pos][m.key].perGame, 0) / (rows.length || 1));
    }
  }
  for (const r of rows)
    for (const pos of POSITIONS)
      for (const k in r.stats[pos]) r.stats[pos][k].perGame = round1(r.stats[pos][k].perGame);

  return { rows, leagueAvg };
}

/** First regular-season week that still has an unplayed game. */
function upcoming(games: Game[]): { week: number | null; games: Game[] } {
  const open = games.filter((g) => g.gameType === 'REG' && g.homeScore == null);
  if (!open.length) return { week: null, games: [] };
  const week = Math.min(...open.map((g) => g.week));
  return { week, games: open.filter((g) => g.week === week) };
}

/** The offense's leading player at a position for a stat this season (by total), with his per-game average. */
function leadingPlayer(weeks: PlayerWeek[], team: string, pos: Position, metric: string) {
  const agg = new Map<string, { name: string; total: number; games: number }>();
  for (const w of weeks) {
    if (w.seasonType !== 'REG' || w.team !== team || positionGroup(w.position) !== pos) continue;
    const a = agg.get(w.playerId) ?? { name: w.name, total: 0, games: 0 };
    a.total += Number(w[metric] ?? 0);
    a.games += 1;
    agg.set(w.playerId, a);
  }
  // Leader by season total, so one big game from a backup can't outrank the starter; show per game.
  let best: { name: string; total: number; games: number } | null = null;
  for (const a of agg.values()) {
    if (!best || a.total > best.total || (a.total === best.total && a.games < best.games)) best = a;
  }
  return best && best.total > 0 ? { name: best.name, perGame: round1(best.total / best.games), games: best.games } : null;
}

function notesFor(
  defense: DefenseRow,
  offense: string,
  weeks: PlayerWeek[],
  leagueAvg: NflResearch['leagueAvg'],
  teamCount: number,
): MatchupNote[] {
  const candidates: Array<{ note: MatchupNote; score: number; order: number }> = [];
  for (const pos of POSITIONS) {
    NOTE_METRICS[pos].forEach((metric, order) => {
      const cell = defense.stats[pos][metric];
      const soft = cell.rank <= 3;
      const tough = cell.rank >= teamCount - 2;
      if (!soft && !tough) return;
      const label = METRICS[pos].find((m) => m.key === metric)!;
      const direction = soft ? 'most' : 'fewest';
      const player = leadingPlayer(weeks, offense, pos, metric);
      const place = soft
        ? cell.rank === 1
          ? 'the most'
          : `the ${ordinal(cell.rank)}-most`
        : cell.rank === teamCount
          ? 'the fewest'
          : `the ${ordinal(teamCount - cell.rank + 1)}-fewest`;
      const text =
        `${nickname(defense.team)} defense allows ${place} ${label.phrase} to ${pos}s ` +
        `(${cell.perGame} per game, league avg ${leagueAvg[pos][metric]}).` +
        (player ? ` ${nickname(offense)} ${pos} ${player.name}: ${player.perGame} ${label.short} per game.` : '');
      candidates.push({
        note: {
          defense: defense.team,
          offense,
          position: pos,
          metric,
          metricLabel: label.label,
          rank: cell.rank,
          perGame: cell.perGame,
          leagueAvg: leagueAvg[pos][metric],
          direction,
          defenseGames: defense.games,
          player,
          text,
        },
        score: soft ? 4 - cell.rank : cell.rank - (teamCount - 3),
        order,
      });
    });
  }
  // One note per position (the most extreme, concrete stats before fantasy points).
  const byPos = new Map<Position, (typeof candidates)[number]>();
  for (const c of candidates.sort((a, b) => b.score - a.score || a.order - b.order)) {
    if (!byPos.has(c.note.position)) byPos.set(c.note.position, c);
  }
  return [...byPos.values()].map((c) => c.note);
}

export async function getNflResearch(season: number): Promise<NflResearch> {
  const [weeks, games] = await Promise.all([playerWeeks(season), schedule(season)]);
  const { rows, leagueAvg } = computeDefense(weeks);
  const byTeam = new Map(rows.map((r) => [r.team, r]));
  const next = upcoming(games);
  const scheme = await schemeNotesFor(season, next.games, weeks);

  const matchups: MatchupGame[] = next.games
    .sort((a, b) => `${a.gameday} ${a.gametime}`.localeCompare(`${b.gameday} ${b.gametime}`))
    .map((g) => {
      const homeD = byTeam.get(g.home);
      const awayD = byTeam.get(g.away);
      const notes = [
        ...(homeD ? notesFor(homeD, g.away, weeks, leagueAvg, rows.length) : []),
        ...(awayD ? notesFor(awayD, g.home, weeks, leagueAvg, rows.length) : []),
      ].sort((a, b) => Math.min(a.rank, rows.length + 1 - a.rank) - Math.min(b.rank, rows.length + 1 - b.rank));
      return {
        gameId: g.gameId,
        away: g.away,
        home: g.home,
        kickoff: `${g.gameday} ${g.gametime}`,
        notes,
        schemeNotes: scheme.get(g.gameId) ?? [],
      };
    });

  const reg = games.filter((g) => g.gameType === 'REG');
  const weeksList = [...new Set(reg.map((g) => g.week))].sort((a, b) => a - b);
  let completedWeek = 0;
  for (const w of weeksList) {
    if (reg.filter((g) => g.week === w).every((g) => g.homeScore != null)) completedWeek = w;
    else break;
  }
  const partialGames = reg.filter((g) => g.week === completedWeek + 1 && g.homeScore != null).length;

  return {
    season,
    generatedAt: new Date().toISOString(),
    completedWeek,
    partialGames,
    weeksCovered: [...new Set(weeks.filter((w) => w.seasonType === 'REG').map((w) => w.week))].sort((a, b) => a - b),
    upcomingWeek: next.week,
    defense: rows.sort((a, b) => a.name.localeCompare(b.name)),
    leagueAvg,
    matchups,
    metrics: METRICS,
  };
}
