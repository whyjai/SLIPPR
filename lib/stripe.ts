import Stripe from 'stripe';

/** True when Stripe secret + price are configured. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (!stripeClient) {
    // No explicit apiVersion: use the version the installed SDK is typed for.
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

/** Maps a Stripe subscription status to our tier. */
export function tierForStatus(status: Stripe.Subscription.Status): 'premium' | 'free' {
  return status === 'active' || status === 'trialing' ? 'premium' : 'free';
}
