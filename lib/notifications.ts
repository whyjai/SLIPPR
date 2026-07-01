import { sendDailySlip, sendDailySlipsToRecipients } from '@/lib/email';
import type { DailySlipsResult } from '@/lib/parlay-engine';
import type { TieredSlip } from '@/lib/types';

export { sendDailySlip };

export async function notifyPremiumUsers(
  slips: TieredSlip[],
  emails: string[],
): Promise<{ sent: number; failed: number }> {
  if (emails.length === 0 || !process.env.RESEND_API_KEY) {
    return { sent: 0, failed: 0 };
  }

  return sendDailySlipsToRecipients(emails, slips);
}

export function buildDailySlipPayload(dailyData: DailySlipsResult) {
  return {
    date: dailyData.date,
    slips: dailyData.slips,
    warnings: dailyData.warnings,
    sharpPublic: dailyData.sharpPublic,
    council: dailyData.council,
  };
}
