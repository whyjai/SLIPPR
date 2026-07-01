import { supabase } from '@/lib/supabase';

const PREMIUM_DAYS = 7;

export function generateReferralCode(userId: string): string {
  return `PG-${userId.slice(0, 8).toUpperCase()}`;
}

async function awardPremiumDays(userId: string) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + PREMIUM_DAYS);

  const { error } = await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      tier: 'premium',
      expires_at: expiresAt.toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) throw error;
}

export async function applyReferral(referralCode: string, newUserId: string) {
  const { data: referrer, error: lookupError } = await supabase
    .from('referral_codes')
    .select('user_id')
    .eq('code', referralCode)
    .single();

  if (lookupError || !referrer) {
    throw new Error('Invalid referral code');
  }

  if (referrer.user_id === newUserId) {
    throw new Error('Cannot use your own referral code');
  }

  const { error: insertError } = await supabase.from('referrals').insert({
    referrer_id: referrer.user_id,
    referred_id: newUserId,
    referral_code: referralCode,
  });

  if (insertError) throw insertError;

  await Promise.all([
    awardPremiumDays(referrer.user_id),
    awardPremiumDays(newUserId),
  ]);

  return { referrerId: referrer.user_id, referredId: newUserId };
}

export async function ensureReferralCode(userId: string): Promise<string> {
  const code = generateReferralCode(userId);

  const { error } = await supabase.from('referral_codes').upsert(
    { user_id: userId, code },
    { onConflict: 'user_id' },
  );

  if (error) throw error;
  return code;
}
