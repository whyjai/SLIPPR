import { NextResponse } from 'next/server';
import { scanStaleLines } from '@/lib/stale-lines';
import { verifyCronRequest } from '@/lib/cron-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Stale Line Alerts scan. One pass per call — hit this as often as you want
 * fresh checks. The main cron (every 3h, vercel.json) is too slow for this to
 * matter; a stale line is usually gone within minutes. Point an external
 * scheduler (cron-job.org, QStash, GitHub Actions) at this route every few
 * minutes, or use Vercel Cron at whatever interval your plan allows —
 * Hobby is limited to once/day per cron job, which defeats the purpose.
 */
export async function GET(req: Request) {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  try {
    const result = await scanStaleLines();
    logger.info('Stale-line scan', {
      scanned: result.scanned,
      moved: result.moved,
      checked: result.checked,
      newAlerts: result.newAlerts.length,
      budget: result.budget,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Stale-line scan failed', { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
