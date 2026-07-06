import { NextResponse } from 'next/server';
import { runDailyCron } from '@/lib/daily-cron';
import { verifyCronRequest } from '@/lib/cron-auth';
import { getLegBoard } from '@/lib/leg-board';
import { runSettlement } from '@/lib/settle';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const authError = verifyCronRequest(req);
  if (authError) {
    logger.warn('Unauthorized cron attempt');
    return authError;
  }

  try {
    // Generate this window's board first: odds scan -> DFS scan -> council
    // vote -> persisted, so every visitor in the window gets instant, real,
    // pre-agreed legs (vercel.json fires this every 3h = 8x/day).
    const board = await getLegBoard();

    logger.info('Board generated', {
      source: board.source,
      legs: board.legs.length,
      councilResponded: board.council.responded,
      warnings: board.warnings.length,
    });

    // Capture closing lines + grade settled picks for the verified track record.
    const settlement = await runSettlement();
    logger.info('Settlement pass', settlement);

    const result = await runDailyCron();

    logger.info('Daily cron completed', {
      slipsGenerated: result.slipsGenerated,
      usersSaved: result.usersSaved,
      emailsSent: result.emails.sent,
      emailsFailed: result.emails.failed,
    });

    return NextResponse.json({
      ...result,
      board: {
        source: board.source,
        legs: board.legs.length,
        councilResponded: board.council.responded,
      },
      settlement,
    });
  } catch (error) {
    logger.error('Cron failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
