import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { appUrl, getStripe, isStripeConfigured } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/** Opens the Stripe billing portal so a member can manage or cancel. */
export async function POST() {
  if (!isSupabaseConfigured() || !isStripeConfigured()) {
    return NextResponse.json({ error: 'Billing is not enabled yet.' }, { status: 503 });
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  const { data } = await getSupabaseAdmin()
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!data?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found.' }, { status: 404 });
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: `${appUrl()}/?tab=settings`,
  });

  return NextResponse.json({ url: session.url });
}
