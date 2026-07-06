'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';
import AuthModal from './premium/AuthModal';

type UpgradeContextValue = {
  /** Open the auth modal (optionally with a contextual reason). */
  requireAuth: (reason?: string) => void;
  /** If signed out, prompt auth; if signed in, start Stripe checkout for Pro. */
  goPro: () => Promise<void>;
  checkoutPending: boolean;
  checkoutError: string;
};

const UpgradeContext = createContext<UpgradeContextValue | null>(null);

export function UpgradeProvider({ children }: { children: ReactNode }) {
  const { user, configured } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [authReason, setAuthReason] = useState<string | undefined>();
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  const requireAuth = useCallback((reason?: string) => {
    setAuthReason(reason);
    setAuthOpen(true);
  }, []);

  const goPro = useCallback(async () => {
    setCheckoutError('');

    if (!configured) {
      setCheckoutError('Billing is not live yet — payment keys are being configured.');
      requireAuth('Pro checkout activates once billing keys are set.');
      return;
    }
    if (!user) {
      requireAuth('Create an account to upgrade to Pro.');
      return;
    }

    setCheckoutPending(true);
    try {
      const res = await fetch('/api/checkout', { method: 'POST' });
      const data: { url?: string; error?: string } = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setCheckoutError(data.error ?? 'Could not start checkout. Try again.');
    } catch {
      setCheckoutError('Could not reach checkout. Try again.');
    } finally {
      setCheckoutPending(false);
    }
  }, [configured, user, requireAuth]);

  const value = useMemo<UpgradeContextValue>(
    () => ({ requireAuth, goPro, checkoutPending, checkoutError }),
    [requireAuth, goPro, checkoutPending, checkoutError],
  );

  return (
    <UpgradeContext.Provider value={value}>
      {children}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} reason={authReason} />
    </UpgradeContext.Provider>
  );
}

export function useUpgrade(): UpgradeContextValue {
  const ctx = useContext(UpgradeContext);
  if (!ctx) throw new Error('useUpgrade must be used within UpgradeProvider');
  return ctx;
}
