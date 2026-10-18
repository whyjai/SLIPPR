/**
 * NHL prop cheat sheet: skater shots on goal, points, goals and assists, and
 * goalie saves, with a calibrated baseline and outcome spread
 * (scripts/research/calibrate-nhl-props.mts).
 */
export type NhlStat = 'shots' | 'points' | 'goals' | 'assists' | 'saves';
export const NHL_STATS: NhlStat[] = ['shots', 'points', 'goals', 'assists', 'saves'];
export const NHL_STAT_LABEL: Record<NhlStat, string> = { shots: 'Shots on goal', points: 'Points', goals: 'Goals', assists: 'Assists', saves: 'Saves' };

/** A stat is a prop (and the calibrated chances apply) only above these baselines. */
export const NHL_MIN_BASE: Record<NhlStat, number> = { shots: 1.5, points: 0.35, goals: 0.15, assists: 0.2, saves: 18 };
