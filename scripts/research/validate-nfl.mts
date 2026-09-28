/**
 * Validate the NFL research numbers against independent sources:
 *   - the raw nflverse play-by-play, recomputed here without the site's aggregation code
 *   - ESPN's official season team stats
 *
 *   npx tsx scripts/research/validate-nfl.mts 2025
 *
 * Run after rebuilding a stored season or when a new week lands. Exits 1 if any
 * check misses its tolerance.
 */
import { loadCharting, streamCsv } from '../../lib/research/nfl-pbp';
import { getNflTeamTendencies, getSeasonAggregate } from '../../lib/research/nfl-teams';
import { getNflPlayerTrends } from '../../lib/research/nfl-players';
import { playerWeeks, schedule } from '../../lib/research/nflverse';

const season = Number(process.argv[2] ?? 2025);
if (!Number.isInteger(season)) throw new Error('usage: validate-nfl.mts <season>');

const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download';
let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}
const spread = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
};

// ---------------------------------------------------------------------------
// Load: finished games only, like the site's live aggregate.
const games = (await schedule(season)).filter((g) => g.gameType === 'REG' && g.homeScore != null);
const final = new Set(games.map((g) => g.gameId));
type Row = Record<string, string>;
const rows: Row[] = [];
await streamCsv(
  `${RELEASES}/pbp/play_by_play_${season}.csv.gz`,
  ['game_id', 'season_type', 'posteam', 'defteam', 'play_type', 'pass', 'qb_dropback', 'sack', 'complete_pass',
   'pass_attempt', 'receiver_player_id', 'epa', 'wp', 'down', 'half_seconds_remaining', 'two_point_attempt',
   'qb_kneel', 'qb_spike'],
  (r) => {
    if (r.season_type === 'REG' && final.has(r.game_id) && r.posteam) rows.push(r);
  },
);
const agg = await getSeasonAggregate(season);
const weeks = (await playerWeeks(season)).filter((w) => w.seasonType === 'REG' && final.has(w.gameId));
console.log(`${season}: ${games.length} final games, ${rows.length} play-by-play rows\n`);

const scrimmage = (r: Row) =>
  (r.play_type === 'pass' || r.play_type === 'run') && r.two_point_attempt !== '1' && r.qb_kneel !== '1' && r.qb_spike !== '1';

// 1. EPA allowed per dropback / designed run, recomputed from raw rows.
{
  const ref: Record<string, { db: number; dbN: number; run: number; runN: number }> = {};
  for (const r of rows) {
    if (!scrimmage(r) || r.epa === 'NA' || r.epa === '') continue;
    const t = (ref[r.defteam] ??= { db: 0, dbN: 0, run: 0, runN: 0 });
    if (r.qb_dropback === '1') { t.db += Number(r.epa); t.dbN++; } else { t.run += Number(r.epa); t.runN++; }
  }
  const diffs = Object.entries(ref).map(([team, t]) => {
    const d = agg.teams[team]?.defense ?? {};
    return Math.max(Math.abs(d.passEpa / d.passPlays - t.db / t.dbN), Math.abs(d.rushEpa / d.runPlays - t.run / t.runN));
  });
  const worst = Math.max(...diffs);
  check('EPA allowed per dropback / run', worst < 0.002, `worst team diff ${worst.toFixed(4)}`);
}

// 2. Games per team.
{
  const sched: Record<string, number> = {};
  for (const g of games) for (const t of [g.home, g.away]) sched[t] = (sched[t] ?? 0) + 1;
  const bad = Object.entries(sched).filter(([t, n]) => agg.teams[t]?.games.length !== n).map(([t]) => t);
  check('Games per team vs schedule', bad.length === 0, bad.length ? `mismatch: ${bad.join(', ')}` : 'all teams match');
}

// 3. Defense vs position: box-score receptions/targets allowed vs play-by-play, every position.
{
  const posById = new Map(weeks.map((w) => [w.playerId, w.position]));
  const box: Record<string, number> = {};
  const pbp: Record<string, number> = {};
  for (const w of weeks) {
    box[`${w.opponent}|${w.position}|rec`] = (box[`${w.opponent}|${w.position}|rec`] ?? 0) + Number(w.receptions ?? 0);
    box[`${w.opponent}|${w.position}|tgt`] = (box[`${w.opponent}|${w.position}|tgt`] ?? 0) + Number(w.targets ?? 0);
  }
  for (const r of rows) {
    if (r.pass_attempt !== '1' || r.sack === '1' || r.two_point_attempt === '1' || !r.receiver_player_id || r.receiver_player_id === 'NA') continue;
    const pos = posById.get(r.receiver_player_id);
    if (!pos) continue;
    pbp[`${r.defteam}|${pos}|tgt`] = (pbp[`${r.defteam}|${pos}|tgt`] ?? 0) + 1;
    if (r.complete_pass === '1') pbp[`${r.defteam}|${pos}|rec`] = (pbp[`${r.defteam}|${pos}|rec`] ?? 0) + 1;
  }
  const keys = Object.keys(box).filter((k) => /\|(WR|TE|RB)\|/.test(k));
  const worst = Math.max(...keys.map((k) => Math.abs(box[k] - (pbp[k] ?? 0))));
  check('Receptions/targets allowed by position, box vs pbp', worst <= 2, `worst diff ${worst} over ${keys.length} team-position cells`);
}

// 4. Player split targets account for box-score targets in charted games (charting lags box scores).
{
  const charted = new Set([...(await loadCharting(season)).keys()].map((k) => k.split('|')[0]).filter((g) => final.has(g)));
  console.log(`      charting: ${agg.chartedThroughWeek ?? '?'} full weeks (+${agg.chartedPartialGames ?? 0}), ${charted.size}/${games.length} final games`);
  const tgt = new Map<string, number>();
  for (const w of weeks) if (charted.has(w.gameId)) tgt.set(w.playerId, (tgt.get(w.playerId) ?? 0) + Number(w.targets ?? 0));
  const min = Math.max(10, (5 * charted.size) / 16);
  const ratios = Object.entries(agg.players)
    .filter(([id]) => (tgt.get(id) ?? 0) >= min)
    .map(([id, p]) => ((p.splits.blitz?.targets ?? 0) + (p.splits.noBlitz?.targets ?? 0)) / tgt.get(id)!);
  const s = spread(ratios);
  check('Split targets / box-score targets', s.min >= 0.95 && s.max <= 1.02, `${ratios.length} receivers, min ${s.min?.toFixed(3)} median ${s.median?.toFixed(3)} max ${s.max?.toFixed(3)}`);
}

// 5. Neutral pass rate vs nflfastR's own `pass` flag.
{
  const tt = await getNflTeamTendencies(season);
  const ref: Record<string, [number, number]> = {};
  for (const r of rows) {
    if (!scrimmage(r)) continue;
    const wp = Number(r.wp), down = Number(r.down), hs = Number(r.half_seconds_remaining);
    if (!(wp >= 0.2 && wp <= 0.8 && hs > 120 && (down === 1 || down === 2))) continue;
    const a = (ref[r.posteam] ??= [0, 0]);
    a[1]++;
    if (r.pass === '1') a[0]++;
  }
  const worst = Math.max(...tt.teams.filter((t) => ref[t.team]).map((t) => Math.abs((t.offense.neutralPassRate.value ?? 0) - (100 * ref[t.team][0]) / ref[t.team][1])));
  check('Neutral pass rate vs nflfastR', worst <= 0.5, `worst diff ${worst.toFixed(2)} pts`);
}

// 6. Snap % coverage on logged games.
{
  const t = await getNflPlayerTrends(season);
  const logs = t.players.flatMap((p) => p.log.filter((g) => g.season === season));
  const pct = (100 * logs.filter((g) => g.snapPct != null).length) / logs.length;
  check('Snap % coverage', pct >= 99, `${pct.toFixed(2)}% of ${logs.length} player-games`);
  const oneGame = [...t.risers, ...t.fallers].filter((c) => (t.players.find((p) => p.id === c.id)?.season.games ?? 0) < 2);
  check('Usage changes have 2+ games', oneGame.length === 0, oneGame.length ? oneGame.map((c) => c.name).join(', ') : 'ok');
}

// 7. ESPN official team stats (independent provider).
{
  const FIX: Record<string, string> = { WSH: 'WAS', LAR: 'LA' };
  type EspnTeam = { id: string; abbreviation: string };
  type EspnStats = { splits: { categories: Array<{ name: string; stats: Array<{ name: string; value: number }> }> } };
  const list = (await (await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams')).json()) as {
    sports: Array<{ leagues: Array<{ teams: Array<{ team: EspnTeam }> }> }>;
  };
  const box: Record<string, { comp: number; passYds: number; rushYds: number }> = {};
  for (const w of weeks) {
    const b = (box[w.team] ??= { comp: 0, passYds: 0, rushYds: 0 });
    b.comp += Number(w.completions ?? 0);
    b.passYds += Number(w.passing_yards ?? 0);
    b.rushYds += Number(w.rushing_yards ?? 0);
  }
  const kneelSpike: Record<string, number> = {};
  for (const r of rows) {
    if (r.two_point_attempt === '1') continue;
    const typed = r.play_type === 'qb_kneel' || r.play_type === 'qb_spike';
    const flagged = (r.play_type === 'pass' || r.play_type === 'run') && (r.qb_kneel === '1' || r.qb_spike === '1');
    if (typed || flagged) kneelSpike[r.posteam] = (kneelSpike[r.posteam] ?? 0) + 1;
  }
  const d = { comp: [] as number[], rushYds: [] as number[], plays: [] as number[], passPct: [] as number[] };
  for (const { team } of list.sports[0].leagues[0].teams) {
    const abbr = FIX[team.abbreviation] ?? team.abbreviation;
    const j = (await (await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/teams/${team.id}/statistics`)).json()) as EspnStats;
    const st: Record<string, number> = {};
    for (const c of j.splits.categories) for (const s of c.stats) st[`${c.name}.${s.name}`] = s.value;
    d.comp.push(box[abbr].comp - st['passing.completions']);
    d.rushYds.push(box[abbr].rushYds - st['rushing.rushingYards']);
    d.plays.push(agg.teams[abbr].offense.plays + (kneelSpike[abbr] ?? 0) - st['passing.totalOffensivePlays']);
    d.passPct.push((100 * Math.abs(box[abbr].passYds - st['passing.passingYards'])) / st['passing.passingYards']);
  }
  const worst = (xs: number[]) => Math.max(...xs.map(Math.abs));
  check('ESPN completions', worst(d.comp) <= 1, `worst diff ${worst(d.comp)}, exact ${d.comp.filter((x) => x === 0).length}/32`);
  check('ESPN rushing yards', worst(d.rushYds) <= 5, `worst diff ${worst(d.rushYds)}, exact ${d.rushYds.filter((x) => x === 0).length}/32`);
  check('ESPN offensive plays (+ kneels/spikes)', worst(d.plays) <= 3, `worst diff ${worst(d.plays)}, exact ${d.plays.filter((x) => x === 0).length}/32`);
  check('ESPN passing yards', worst(d.passPct) <= 1.5, `worst diff ${worst(d.passPct).toFixed(2)}%`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
