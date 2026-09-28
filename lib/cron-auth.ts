import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * Cron endpoints spend Odds API credits, so they fail closed: with no
 * CRON_SECRET configured nobody gets in (a missing header used to match an
 * unset secret, since undefined === undefined).
 */
export function verifyCronRequest(req: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  const given = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';

  const ok =
    !!expected &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));

  return ok ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
