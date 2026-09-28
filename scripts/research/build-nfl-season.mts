/**
 * Freeze a finished NFL season's play-level aggregates into the repo, so the
 * app never has to re-download ~200 MB of play-by-play + participation data
 * for a season that can't change. Run once after the season (and after
 * nflverse publishes that season's participation file, for man/zone):
 *
 *   npx tsx scripts/research/build-nfl-season.mts 2025
 */
import { writeFileSync } from 'node:fs';
import { aggregate, loadCharting, loadCoverage, loadPlays } from '../../lib/research/nfl-pbp';

const season = Number(process.argv[2]);
if (!Number.isInteger(season)) throw new Error('usage: build-nfl-season.mts <season>');

const t = Date.now();
const [plays, charting, coverage] = await Promise.all([
  loadPlays(season),
  loadCharting(season),
  loadCoverage(season).catch((e) => {
    console.warn(`no coverage data for ${season}: ${e.message}`);
    return new Map<string, 'man' | 'zone'>();
  }),
]);
const agg = aggregate(season, plays, charting, coverage);

// Round float sums so the file stays small.
const round = (o: Record<string, number>) => {
  for (const k in o) o[k] = Math.round(o[k] * 100) / 100;
};
for (const t of Object.values(agg.teams)) {
  round(t.offense);
  round(t.defense);
}
for (const p of Object.values(agg.players)) for (const s of Object.values(p.splits)) round(s!);

const out = `data/research/nfl-${season}.json`;
writeFileSync(out, JSON.stringify(agg));
console.log(
  `${out}: ${plays.length} plays, ${charting.size} charted, ${coverage.size} with coverage, ` +
    `${Object.keys(agg.players).length} players, through week ${agg.throughWeek} (${Math.round((Date.now() - t) / 1000)}s)`,
);
