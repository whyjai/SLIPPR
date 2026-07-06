import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

/** Returns the authenticated user's current subscription tier. */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ tier: 'free', configured: false });
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ tier: 'free', authenticated: false });
  }

  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, expires_at')
    .eq('user_id', user.id)
    .maybeSingle();

  const active =
    data &&
    data.tier !== 'free' &&
    (!data.status || data.status === 'active' || data.status === 'trialing') &&
    (!data.expires_at || new Date(data.expires_at) > new Date());

  return NextResponse.json({
    tier: active ? data!.tier : 'free',
    status: data?.status ?? null,
    authenticated: true,
  });
}
