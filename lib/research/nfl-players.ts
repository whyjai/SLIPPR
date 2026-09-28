import { nameKey, pfrToGsis, playerWeeks, snapCounts, type PlayerWeek } from './nflverse';

/**
 * Player trends: usage and production per game this season, the last three
 * games, and last season for comparison, plus a 10-game log (across both
 * seasons) that hit rates are computed from. Box scores and snap counts only.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE';

export type GameLogEntry = {
  season: number;
  week: number;
  opponent: string;
  snapPct: number | null; // 0–100
  targets: number;
  targetShare: number; // 0–100
  receptions: number;
  recYds: number;
  recTd: number;
  carries: number;
  rushYds: number;
  rushTd: number;
  passAtt: number;
  passYds: number;
  passTd: number;
  fpts: number;
};

export type Averages = {
  games: number;
  snapPct: number | null;
  targets: number;
  targetShare: number;
  receptions: number;
  recYds: number;
  carries: number;
  rushYds: number;
  passAtt: number;
  passYds: number;
  passTd: number;
  fpts: number;
};

export type PlayerTrend = {
  id: string;
  name: string;
  position: Position;
  team: string;
  season: Averages;
  last3: Averages;
  prior: Averages | null; // last season, when he played 4+ games
  log: GameLogEntry[]; // newest first, up to 10 regular-season games
};

export type UsageChange = {
  id: string;
  name: string;
  position: Position;
  team: string;
  metric: 'Target share' | 'Snap %' | 'Carries per game';
  now: number;
  before: number;
  delta: number;
};

export type NflPlayerTrends = {
  season: number;
  generatedAt: string;
  players: PlayerTrend[];
  risers: UsageChange[];
  fallers: UsageChange[];
};

const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'FB']);
const LOG_GAMES = 10;
const round1 = (n: number) => Math.round(n * 10) / 10;

function toEntry(w: PlayerWeek, snap: number | undefined): GameLogEntry {
  const n = (k: string) => Number(w[k] ?? 0);
  return {
    season: w.season,
    week: w.week,
    opponent: w.opponent,
    snapPct: snap == null ? null : Math.round(snap * 100),
    targets: n('targets'),
    targetShare: round1(n('target_share') * 100),
    receptions: n('receptions'),
    recYds: n('receiving_yards'),
    recTd: n('receiving_tds'),
    carries: n('carries'),
    rushYds: n('rushing_yards'),
    rushTd: n('rushing_tds'),
    passAtt: n('attempts'),
    passYds: n('passing_yards'),
    passTd: n('passing_tds'),
    fpts: round1(n('fantasy_points_ppr')),
  };
}

function average(games: GameLogEntry[]): Averages {
  const avg = (f: (g: GameLogEntry) => number) => round1(games.reduce((s, g) => s + f(g), 0) / (games.length || 1));
  const snaps = games.filter((g) => g.snapPct != null);
  return {
    games: games.length,
    snapPct: snaps.length ? Math.round(snaps.reduce((s, g) => s + (g.snapPct ?? 0), 0) / snaps.length) : null,
    targets: avg((g) => g.targets),
    targetShare: avg((g) => g.targetShare),
    receptions: avg((g) => g.receptions),
    recYds: avg((g) => g.recYds),
    carries: avg((g) => g.carries),
    rushYds: avg((g) => g.rushYds),
    passAtt: avg((g) => g.passAtt),
    passYds: avg((g) => g.passYds),
    passTd: avg((g) => g.passTd),
    fpts: avg((g) => g.fpts),
  };
}

/** Is this player part of the offense, not a mop-up appearance? */
function involved(pos: Position, a: Averages): boolean {
  if (pos === 'QB') return a.passAtt >= 10;
  return (a.snapPct ?? 0) >= 15 || a.targets + a.carries >= 2;
}

export async function getNflPlayerTrends(season: number): Promise<NflPlayerTrends> {
  const [cur, prev, snapsCur, snapsPrev, xwalk] = await Promise.all([
    playerWeeks(season),
    playerWeeks(season - 1).catch(() => [] as PlayerWeek[]),
    snapCounts(season).catch(() => []),
    snapCounts(season - 1).catch(() => []),
    pfrToGsis().catch(() => new Map<string, string>()),
  ]);
  // Join by player id through the PFR crosswalk; name + team only as a fallback.
  const snapById = new Map<string, number>();
  const snapByName = new Map<string, number>();
  for (const s of [...snapsPrev, ...snapsCur]) {
    if (s.gameType !== 'REG') continue;
    const gsis = xwalk.get(s.pfrId);
    if (gsis) snapById.set(`${gsis}|${s.season}|${s.week}`, s.offensePct);
    snapByName.set(`${nameKey(s.player)}|${s.team}|${s.season}|${s.week}`, s.offensePct);
  }
  const snapFor = (w: PlayerWeek) =>
    snapById.get(`${w.playerId}|${w.season}|${w.week}`) ??
    snapByName.get(`${nameKey(w.name)}|${w.team}|${w.season}|${w.week}`);

  const byPlayer = new Map<string, PlayerWeek[]>();
  for (const w of [...prev, ...cur]) {
    if (w.seasonType !== 'REG' || !SKILL.has(w.position)) continue;
    byPlayer.set(w.playerId, [...(byPlayer.get(w.playerId) ?? []), w]);
  }

  const players: PlayerTrend[] = [];
  for (const [id, weeks] of byPlayer) {
    const thisSeason = weeks.filter((w) => w.season === season);
    if (!thisSeason.length) continue;
    weeks.sort((a, b) => a.season - b.season || a.week - b.week);
    const entry = (w: PlayerWeek) => toEntry(w, snapFor(w));
    const curLog = thisSeason.map(entry);
    const priorLog = weeks.filter((w) => w.season === season - 1).map(entry);
    const latest = thisSeason[thisSeason.length - 1];
    const position = (latest.position === 'FB' ? 'RB' : latest.position) as Position;
    const seasonAvg = average(curLog);
    if (!involved(position, seasonAvg)) continue;
    players.push({
      id,
      name: latest.name,
      position,
      team: latest.team,
      season: seasonAvg,
      last3: average(curLog.slice(-3)),
      prior: priorLog.length >= 4 ? average(priorLog) : null,
      log: [...priorLog, ...curLog].slice(-LOG_GAMES).reverse(),
    });
  }
  players.sort((a, b) => b.season.fpts - a.season.fpts);

  // Usage changes vs last season. Thresholds keep noise out: the player must
  // have a real role now or before, and the swing must be meaningful.
  const changes: UsageChange[] = [];
  for (const p of players) {
    // Two games minimum: one early injury exit would otherwise read as a lost role.
    if (!p.prior || p.position === 'QB' || p.season.games < 2) continue;
    const add = (metric: UsageChange['metric'], now: number | null, before: number | null, minSwing: number) => {
      if (now == null || before == null) return;
      const delta = round1(now - before);
      if (Math.abs(delta) >= minSwing) changes.push({ id: p.id, name: p.name, position: p.position, team: p.team, metric, now, before, delta });
    };
    if (p.position !== 'RB' || p.season.targetShare >= 10 || p.prior.targetShare >= 10) {
      add('Target share', p.season.targetShare, p.prior.targetShare, 6);
    }
    add('Snap %', p.season.snapPct, p.prior.snapPct, 20);
    if (p.position === 'RB') add('Carries per game', p.season.carries, p.prior.carries, 5);
  }
  // One entry per player: his biggest swing, scaled so snap % (0–100) doesn't drown out the others.
  const scale = { 'Target share': 1, 'Snap %': 0.35, 'Carries per game': 1.2 } as const;
  const best = new Map<string, UsageChange>();
  for (const c of changes) {
    const cur = best.get(c.id);
    if (!cur || Math.abs(c.delta) * scale[c.metric] > Math.abs(cur.delta) * scale[cur.metric]) best.set(c.id, c);
  }
  const ranked = [...best.values()].sort((a, b) => Math.abs(b.delta) * scale[b.metric] - Math.abs(a.delta) * scale[a.metric]);

  return {
    season,
    generatedAt: new Date().toISOString(),
    players,
    risers: ranked.filter((c) => c.delta > 0).slice(0, 8),
    fallers: ranked.filter((c) => c.delta < 0).slice(0, 8),
  };
}
