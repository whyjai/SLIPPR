import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { appUrl, getStripe, isStripeConfigured } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/** Creates a Stripe Checkout session for the authenticated user's Pro upgrade. */
export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Accounts are not enabled yet.' }, { status: 503 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: 'Billing is not live yet — Stripe keys are being configured.' },
      { status: 503 },
    );
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to upgrade.' }, { status: 401 });
  }

  const stripe = getStripe();
  const admin = getSupabaseAdmin();

  // Reuse an existing Stripe customer if we have one on file.
  const { data: existing } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  let customerId = existing?.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await admin
      .from('subscriptions')
      .upsert(
        { user_id: user.id, tier: 'free', stripe_customer_id: customerId },
        { onConflict: 'user_id' },
      );
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${appUrl()}/?tab=board&upgraded=1`,
    cancel_url: `${appUrl()}/?tab=builder`,
    subscription_data: { metadata: { supabase_user_id: user.id } },
    metadata: { supabase_user_id: user.id },
  });

  return NextResponse.json({ url: session.url });
}
