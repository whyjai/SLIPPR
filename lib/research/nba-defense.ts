/**
 * NBA defense vs position (ESPN's G / F / C) and the page payload: rankings
 * plus the next slate's matchup cards.
 *
 * Signal (scripts/research/audit-nba.mts, 2025-26): what a defense allowed to
 * guards in its first 20-41 games predicted the rest of the season modestly
 * (r ~0.3-0.5); forwards and centers barely at all (r ~0-0.3, points ~0).
 * Position labels are coarse and matchups switch, so F and C are flagged noisy.
 */
import { NBA_TEAMS, latestNbaSeason, nbaPlayerGames, seasonLabel, type NbaPos } from './nba-data';
import { getNbaSlate, type NbaSlate, type StyleStat } from './nba-matchups';

export const NBA_POSITIONS: NbaPos[] = ['G', 'F', 'C'];
export const NBA_DVP_METRICS: Array<{ key: StyleStat; label: string }> = [
  { key: 'pts', label: 'Points' },
  { key: 'reb', label: 'Rebounds' },
  { key: 'ast', label: 'Assists' },
  { key: 'fg3m', label: '3-pointers made' },
  { key: 'pra', label: 'Pts + reb + ast' },
];
export const NOISY_POSITIONS: Record<NbaPos, boolean> = { G: false, F: true, C: true };

export type NbaDvpRow = {
  team: string;
  name: string;
  games: number;
  stats: Record<NbaPos, Record<StyleStat, { perGame: number; rank: number }>>;
};

export type NbaResearch = {
  sport: 'nba';
  season: number;
  seasonLabel: string;
  latestSeason: number;
  gamesPlayed: number;
  generatedAt: string;
  defense: NbaDvpRow[];
  leagueAvg: Record<NbaPos, Record<StyleStat, number>>;
  metrics: typeof NBA_DVP_METRICS;
  noisy: Record<NbaPos, boolean>;
  slate: NbaSlate | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function getNbaResearch(season: number): Promise<NbaResearch> {
  const [players, latest] = await Promise.all([nbaPlayerGames(season), latestNbaSeason()]);
  const totals = new Map<string, number>();
  const games = new Map<string, Set<string>>();
  for (const p of players) {
    (games.get(p.opp) ?? games.set(p.opp, new Set()).get(p.opp)!).add(p.gameId);
    if (!p.pos) continue;
    const add = (stat: StyleStat, v: number) => totals.set(`${p.opp}|${p.pos}|${stat}`, (totals.get(`${p.opp}|${p.pos}|${stat}`) ?? 0) + v);
    add('pts', p.pts);
    add('reb', p.reb);
    add('ast', p.ast);
    add('fg3m', p.fg3m);
    add('pra', p.pts + p.reb + p.ast);
  }
  const teams = Object.keys(NBA_TEAMS).filter((t) => games.has(t));
  const rows: NbaDvpRow[] = teams.map((team) => {
    const g = games.get(team)!.size;
    const stats = {} as NbaDvpRow['stats'];
    for (const pos of NBA_POSITIONS) {
      stats[pos] = {} as Record<StyleStat, { perGame: number; rank: number }>;
      for (const m of NBA_DVP_METRICS) stats[pos][m.key] = { perGame: (totals.get(`${team}|${pos}|${m.key}`) ?? 0) / g, rank: 0 };
    }
    return { team, name: `${NBA_TEAMS[team].city} ${NBA_TEAMS[team].nickname}`, games: g, stats };
  });
  const leagueAvg = {} as NbaResearch['leagueAvg'];
  for (const pos of NBA_POSITIONS) {
    leagueAvg[pos] = {} as Record<StyleStat, number>;
    for (const m of NBA_DVP_METRICS) {
      const sorted = [...rows].sort((a, b) => b.stats[pos][m.key].perGame - a.stats[pos][m.key].perGame);
      sorted.forEach((r, i) => {
        const prev = sorted[i - 1];
        const cell = r.stats[pos][m.key];
        cell.rank = prev && prev.stats[pos][m.key].perGame === cell.perGame ? prev.stats[pos][m.key].rank : i + 1;
      });
      leagueAvg[pos][m.key] = r1(rows.reduce((s, r) => s + r.stats[pos][m.key].perGame, 0) / (rows.length || 1));
    }
  }
  for (const r of rows) for (const pos of NBA_POSITIONS) for (const m of NBA_DVP_METRICS) r.stats[pos][m.key].perGame = r1(r.stats[pos][m.key].perGame);

  // The slate is about the next games, so it rides along only with the latest season.
  const slate = season === latest ? await getNbaSlate().catch(() => null) : null;
  return {
    sport: 'nba',
    season,
    seasonLabel: seasonLabel(season),
    latestSeason: latest,
    // Fewest played: the two NBA Cup finalists get an 83rd game.
    gamesPlayed: rows.length ? Math.min(...rows.map((r) => r.games)) : 0,
    generatedAt: new Date().toISOString(),
    defense: rows.sort((a, b) => a.name.localeCompare(b.name)),
    leagueAvg,
    metrics: NBA_DVP_METRICS,
    noisy: NOISY_POSITIONS,
    slate,
  };
}
