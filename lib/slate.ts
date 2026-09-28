/** US Eastern calendar day — how bettors mean "today's slate". */
export const BOARD_TZ = 'America/New_York';

export function boardDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BOARD_TZ }).format(date);
}

/** Event tips today (ET) and hasn't been over for hours. */
export function isOnTodaysSlate(startTimeIso: string, now = new Date()): boolean {
  const start = new Date(startTimeIso);
  if (Number.isNaN(start.getTime())) return false;
  if (start.getTime() < now.getTime() - 6 * 3600_000) return false;
  return boardDayKey(start) === boardDayKey(now);
}

export function filterLegsForToday<T extends { startTime: string }>(
  legs: T[],
  now = new Date(),
): T[] {
  return legs.filter((l) => isOnTodaysSlate(l.startTime, now));
}

/** Build an ISO start time for today in US Eastern at the given hour/minute. */
export function startTimeTodayEt(hourEt: number, minuteEt: number, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOARD_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(now)
    .reduce(
      (acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
      },
      {} as Record<string, string>,
    );

  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);

  const probe = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  const etHour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: BOARD_TZ, hour: 'numeric', hour12: false }).format(
      probe,
    ),
  );
  const offsetHours = 17 - etHour;
  return new Date(Date.UTC(y, m - 1, d, hourEt + offsetHours, minuteEt, 0)).toISOString();
}

export function todayEtLabel(now = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: BOARD_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(now);
}
