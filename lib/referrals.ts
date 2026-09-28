import { getSupabaseAdmin } from '@/lib/supabase-admin';

// Server-only: writes subscriptions, so it uses the service role. Callers pass
// the session user's id, never one from the request body.
const db = () => getSupabaseAdmin();

const PREMIUM_DAYS = 7;

export function generateReferralCode(userId: string): string {
  return `SLIPPR-${userId.slice(0, 8).toUpperCase()}`;
}

async function awardPremiumDays(userId: string) {
  // Never touch a paying subscriber's row (it would set an expiry on it).
  const { data: current } = await db()
    .from('subscriptions')
    .select('tier, stripe_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (current?.stripe_subscription_id || (current && current.tier !== 'free')) return;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + PREMIUM_DAYS);

  const { error } = await db().from('subscriptions').upsert(
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
  // One referral per account.
  const { data: already } = await db().from('referrals').select('id').eq('referred_id', newUserId).maybeSingle();
  if (already) throw new Error('Referral already applied');

  const { data: referrer, error: lookupError } = await db()
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

  const { error: insertError } = await db().from('referrals').insert({
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

  const { error } = await db().from('referral_codes').upsert(
    { user_id: userId, code },
    { onConflict: 'user_id' },
  );

  if (error) throw error;
  return code;
}
