'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export type SubscriptionTier = 'free' | 'basic' | 'premium';

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  user: User | null;
  session: Session | null;
  tier: SubscriptionTier;
  isPro: boolean;
  refreshTier: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [tier, setTier] = useState<SubscriptionTier>('free');

  const refreshTier = useCallback(async () => {
    if (!configured) return;
    try {
      const res = await fetch('/api/subscription', { cache: 'no-store' });
      if (!res.ok) return;
      const data: { tier?: SubscriptionTier } = await res.json();
      setTier(data.tier ?? 'free');
    } catch {
      setTier('free');
    }
  }, [configured]);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    const supabase = getBrowserSupabase();
    let active = true;

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
      if (data.session) void refreshTier();
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, nextSession: Session | null) => {
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        if (nextSession) void refreshTier();
        else setTier('free');
      },
    );

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [configured, refreshTier]);

  const signOut = useCallback(async () => {
    if (!configured) return;
    await getBrowserSupabase().auth.signOut();
    setTier('free');
  }, [configured]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      loading,
      user,
      session,
      tier,
      isPro: tier === 'basic' || tier === 'premium',
      refreshTier,
      signOut,
    }),
    [configured, loading, user, session, tier, refreshTier, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
