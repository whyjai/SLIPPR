import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, isStripeConfigured, tierForStatus } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Stripe webhook: the single source of truth for subscription state. Verifies
 * the signature, then upserts the user's tier into `subscriptions` keyed by the
 * Stripe customer id.
 */
export async function POST(req: Request) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  const stripe = getStripe();
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature ?? '', process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn('Stripe webhook signature verification failed', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  async function syncSubscription(sub: Stripe.Subscription) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const supabaseUserId = sub.metadata?.supabase_user_id;
    const tier = tierForStatus(sub.status);
    const periodEnd = sub.items.data[0]?.current_period_end ?? null;

    const record = {
      tier,
      status: sub.status,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      price_id: sub.items.data[0]?.price.id ?? null,
      expires_at: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    // Prefer the user id from metadata; fall back to matching the customer id.
    if (supabaseUserId) {
      await admin
        .from('subscriptions')
        .upsert({ user_id: supabaseUserId, ...record }, { onConflict: 'user_id' });
    } else {
      await admin.from('subscriptions').update(record).eq('stripe_customer_id', customerId);
    }
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object);
        break;
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id,
          );
          await syncSubscription(sub);
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    logger.error('Stripe webhook handler failed', {
      type: event.type,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
