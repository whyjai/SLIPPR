import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { applyReferral, ensureReferralCode } from '@/lib/referrals';

// Both actions act on the signed-in user only; ids in the body are ignored.
export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { referralCode, action } = await req.json();

  try {
    if (action === 'generate') {
      return NextResponse.json({ code: await ensureReferralCode(user.id) });
    }
    if (action === 'apply' && typeof referralCode === 'string') {
      const result = await applyReferral(referralCode, user.id);
      return NextResponse.json({ success: true, ...result });
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Referral failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
