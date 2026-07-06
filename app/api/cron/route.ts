import { NextResponse } from 'next/server';
import { runDailyCron } from '@/lib/daily-cron';
import { verifyCronRequest } from '@/lib/cron-auth';
import { generateLegBoard } from '@/lib/leg-board';
import { runSettlement } from '@/lib/settle';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * The single scheduled job (vercel.json: every 3h = 8×/day). Each phase is
 * isolated so a failure in settlement or the email digest can never prevent the
 * board — the core product — from being generated and persisted. Always returns
 * 200 with a per-phase status so a partial failure doesn't mark the cron failed.
 */
export async function GET(req: Request) {
  const authError = verifyCronRequest(req);
  if (authError) {
    logger.warn('Unauthorized cron attempt');
    return authError;
  }

  const summary: Record<string, unknown> = {};

  // 1. Board generation — the critical phase (odds scan → council → persist).
  try {
    const board = await generateLegBoard();
    const info = {
      source: board.source,
      legs: board.legs.length,
      councilResponded: board.council.responded,
    };
    summary.board = info;
    logger.info('Board generated', info);
  } catch (error) {
    summary.board = { error: errMessage(error) };
    logger.error('Board generation failed', { error: errMessage(error) });
  }

  // 2. Settlement — capture closing lines + grade settled picks (best-effort).
  try {
    const settlement = await runSettlement();
    summary.settlement = settlement;
    logger.info('Settlement pass', settlement);
  } catch (error) {
    summary.settlement = { error: errMessage(error) };
    logger.error('Settlement failed', { error: errMessage(error) });
  }

  // 3. Daily digest / saved-slip emails (best-effort).
  try {
    const result = await runDailyCron();
    const info = {
      slipsGenerated: result.slipsGenerated,
      usersSaved: result.usersSaved,
      emailsSent: result.emails.sent,
      emailsFailed: result.emails.failed,
    };
    summary.daily = info;
    logger.info('Daily cron completed', info);
  } catch (error) {
    summary.daily = { error: errMessage(error) };
    logger.error('Daily cron failed', { error: errMessage(error) });
  }

  return NextResponse.json({ ok: true, ...summary });
}
