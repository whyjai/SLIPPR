import { ParlayEngine } from '@/lib/parlay-engine';
import { buildDailySlipPayload, notifyPremiumUsers } from '@/lib/notifications';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export type DailyCronResult = {
  status: 'success';
  slipsGenerated: number;
  usersSaved: number;
  emails: { sent: number; failed: number };
  timestamp: string;
};

export async function runDailyCron(): Promise<DailyCronResult> {
  const supabase = getSupabaseAdmin();
  const engine = new ParlayEngine();
  const dailyData = await engine.generateDailySlips();
  const slipPayload = buildDailySlipPayload(dailyData);

  const { data: users, error: usersError } = await supabase
    .from('subscriptions')
    .select('user_id, tier');

  if (usersError) throw usersError;

  const premiumUsers = (users ?? []).filter((user) => user.tier !== 'free');
  let usersSaved = 0;

  for (const user of premiumUsers) {
    const { error } = await supabase.from('bet_history').insert({
      user_id: user.user_id,
      slip: slipPayload,
      result: 'pending',
    });

    if (!error) usersSaved++;
  }

  const premiumIds = premiumUsers.map((user) => user.user_id);
  let emails: string[] = [];

  if (premiumIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', premiumIds);

    emails = (profiles ?? [])
      .map((profile) => profile.email)
      .filter((email): email is string => Boolean(email));
  }

  const fallbackEmails =
    process.env.DAILY_EMAIL_RECIPIENTS?.split(',').filter(Boolean) ?? [];
  const allEmails = [...new Set([...emails, ...fallbackEmails])];

  const emailResult = await notifyPremiumUsers(dailyData.slips, allEmails);

  logger.info('Daily cron pipeline finished', {
    slipsGenerated: dailyData.slips.length,
    usersSaved,
    emailRecipients: allEmails.length,
    emailsSent: emailResult.sent,
  });

  return {
    status: 'success',
    slipsGenerated: dailyData.slips.length,
    usersSaved,
    emails: emailResult,
    timestamp: new Date().toISOString(),
  };
}
