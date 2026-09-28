import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';

/**
 * Server-side paywall. Research is free; the betting tools (Leg Board, Prop
 * Edges, Slip Builder, Sharp vs Public, stale-line alerts) are Pro. The client
 * hides locked rows too, but only this check keeps the data out of free
 * responses.
 */

export type SubscriptionTier = 'free' | 'basic' | 'premium';

export type Entitlement = {
  tier: SubscriptionTier;
  status: string | null;
  authenticated: boolean;
  configured: boolean;
};

export const isPaidTier = (tier: SubscriptionTier) => tier === 'basic' || tier === 'premium';

/** Free-tier teaser sizes, shared by the API routes and the views. */
export const FREE_LIMITS = { legs: 15, propEdges: 5 } as const;

/** Responses that differ per user must never be cached by the CDN. */
export const PRIVATE_CACHE = { 'Cache-Control': 'private, no-store' } as const;

/** What a free response carries so the view can say how much is locked. */
export type Locked = { locked?: number };

export async function getEntitlement(): Promise<Entitlement> {
  // Local testing of Pro views without a paid account: DEV_FORCE_TIER=premium.
  const forced = process.env.DEV_FORCE_TIER as SubscriptionTier | undefined;
  if (process.env.NODE_ENV === 'development' && forced && ['free', 'basic', 'premium'].includes(forced)) {
    return { tier: forced, status: 'dev', authenticated: true, configured: isSupabaseConfigured() };
  }

  if (!isSupabaseConfigured()) {
    return { tier: 'free', status: null, authenticated: false, configured: false };
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { tier: 'free', status: null, authenticated: false, configured: true };

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

  return {
    tier: active ? (data!.tier as SubscriptionTier) : 'free',
    status: data?.status ?? null,
    authenticated: true,
    configured: true,
  };
}

export async function isPro(): Promise<boolean> {
  return isPaidTier((await getEntitlement()).tier);
}

/** 402 for endpoints with no free tier at all. */
export function proRequired() {
  return NextResponse.json(
    { error: 'SLIPPR Pro required', proRequired: true },
    { status: 402, headers: PRIVATE_CACHE },
  );
}
