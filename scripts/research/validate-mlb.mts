/**
 * Validate the MLB research numbers: play-by-play aggregated here vs. MLB's
 * official team season totals (StatsAPI), runs vs final scores, and the slate.
 *
 *   npx tsx scripts/research/validate-mlb.mts 2026
 *
 * Exits 1 if any check misses its tolerance.
 */
import { addPlay, emptyLine, mlbPlays, mlbSchedule, mlbTeams, nextMlbSlate, type Line } from '../../lib/research/mlb-data';

const season = Number(process.argv[2] ?? new Date().getUTCFullYear());
let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}
const maxAbs = (xs: number[]) => Math.max(...xs.map(Math.abs));

const [plays, schedule, teams] = await Promise.all([mlbPlays(season), mlbSchedule(season), mlbTeams(season)]);
const reg = plays.filter((p) => p.type === 'R');
const finals = schedule.filter((g) => g.type === 'R' && g.final);
console.log(`MLB ${season}: ${finals.length} final regular-season games, ${reg.length} plays\n`);

// 1. Every final game has plays.
{
  const withPlays = new Set(reg.map((p) => p.gamePk));
  const missing = finals.filter((g) => !withPlays.has(g.gamePk));
  check('Final games with play-by-play', missing.length <= 2, `${finals.length - missing.length}/${finals.length}`);
  // A full game has ~75 plate appearances; far fewer means the source only has part of it (e.g. suspended).
  const pas = new Map<number, number>();
  for (const p of reg) if (p.pa) pas.set(p.gamePk, (pas.get(p.gamePk) ?? 0) + 1);
  const partial = [...pas].filter(([, n]) => n < 50);
  for (const g of missing) console.log(`      missing: ${g.gamePk} ${g.date}`);
  for (const [pk, n] of partial) console.log(`      partial: ${pk} (${n} PA)`);
}

// 2. Runs from plays vs final scores.
{
  const runs = new Map<number, number>();
  for (const p of reg) runs.set(p.gamePk, (runs.get(p.gamePk) ?? 0) + p.runs);
  const bad = finals.filter((g) => runs.has(g.gamePk) && runs.get(g.gamePk) !== (g.homeScore ?? 0) + (g.awayScore ?? 0));
  check('Runs from plays = final score', bad.length / finals.length <= 0.01, `${finals.length - bad.length}/${finals.length} games match`);
}

// 3. Official team season totals.
{
  type Stat = Record<string, string | number | undefined>;
  const json = (await (
    await fetch(`https://statsapi.mlb.com/api/v1/teams/stats?season=${season}&group=hitting,pitching&stats=season&sportIds=1&gameType=R`)
  ).json()) as { stats: Array<{ group: { displayName: string }; splits: Array<{ team: { id: number }; stat: Stat }> }> };
  const bat = new Map<number, Line>();
  const pitch = new Map<number, Line>();
  for (const p of reg) {
    const b = bat.get(p.bat) ?? emptyLine();
    addPlay(b, p);
    bat.set(p.bat, b);
    const f = pitch.get(p.fld) ?? emptyLine();
    addPlay(f, p);
    pitch.set(p.fld, f);
  }
  // Per game, so a game missing from the play-by-play (it happens) doesn't count against every stat.
  const gamesWithPlays = new Map<number, Set<number>>();
  for (const p of reg) for (const t of [p.bat, p.fld]) (gamesWithPlays.get(t) ?? gamesWithPlays.set(t, new Set()).get(t)!).add(p.gamePk);
  const diffs: Record<string, number[]> = {};
  let team = 0;
  let official = 1;
  const push = (k: string, ours: number, theirs: number) => {
    const mine = ours / (gamesWithPlays.get(team)?.size || 1);
    const theirsPer = theirs / (official || 1);
    (diffs[k] ??= []).push(theirsPer ? (100 * (mine - theirsPer)) / theirsPer : 0);
  };
  const ip = (s: string | number | undefined) => {
    const [w, f] = String(s ?? '0').split('.');
    return Number(w) * 3 + Number(f ?? 0);
  };
  for (const blk of json.stats) {
    for (const sp of blk.splits) {
      const s = sp.stat;
      team = sp.team.id;
      official = Number(s.gamesPlayed);
      if (blk.group.displayName === 'hitting') {
        const l = bat.get(sp.team.id);
        if (!l) continue;
        push('PA', l.pa, Number(s.plateAppearances));
        push('AB', l.ab, Number(s.atBats));
        push('H', l.h, Number(s.hits));
        push('HR', l.hr, Number(s.homeRuns));
        push('BB', l.bb, Number(s.baseOnBalls));
        push('K', l.k, Number(s.strikeOuts));
        push('R', l.runs, Number(s.runs));
      } else {
        const l = pitch.get(sp.team.id);
        if (!l) continue;
        push('BF', l.pa, Number(s.battersFaced));
        push('IP (outs)', l.outs, ip(s.inningsPitched));
        push('K allowed', l.k, Number(s.strikeOuts));
      }
    }
  }
  for (const [k, v] of Object.entries(diffs)) {
    // 1%: the source occasionally misses a game or part of one (2026: one of each), which moves a team ~0.6%.
    const tol = 1;
    check(`Official ${k} per team`, v.length === 30 && maxAbs(v) <= tol, `worst team diff ${maxAbs(v).toFixed(2)}% over ${v.length} teams`);
  }
  check('Teams', teams.size === 30, `${teams.size}`);
}

// 4. Slate.
{
  const slate = await nextMlbSlate();
  if (!slate) console.log('SKIP  No upcoming MLB games in the next two weeks');
  else {
    const withProbables = slate.games.filter((g) => g.homeProbable && g.awayProbable).length;
    console.log(`      next slate ${slate.date}: ${slate.games.length} games, ${withProbables} with both probable starters`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
