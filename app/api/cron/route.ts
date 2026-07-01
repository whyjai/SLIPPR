import { NextResponse } from 'next/server';
import { runDailyCron } from '@/lib/daily-cron';
import { verifyCronRequest } from '@/lib/cron-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authError = verifyCronRequest(req);
  if (authError) {
    logger.warn('Unauthorized cron attempt');
    return authError;
  }

  try {
    const result = await runDailyCron();

    logger.info('Daily cron completed', {
      slipsGenerated: result.slipsGenerated,
      usersSaved: result.usersSaved,
      emailsSent: result.emails.sent,
      emailsFailed: result.emails.failed,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error('Cron failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
