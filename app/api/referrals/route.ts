import { NextResponse } from 'next/server';
import { applyReferral, ensureReferralCode } from '@/lib/referrals';

export async function POST(req: Request) {
  const body = await req.json();
  const { referralCode, newUserId, action, userId } = body;

  try {
    if (action === 'generate' && userId) {
      const code = await ensureReferralCode(userId);
      return NextResponse.json({ code });
    }

    if (action === 'apply' && referralCode && newUserId) {
      const result = await applyReferral(referralCode, newUserId);
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Referral failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
