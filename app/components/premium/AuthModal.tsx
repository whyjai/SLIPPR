'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { useAuth } from '../AuthProvider';

type AuthModalProps = {
  open: boolean;
  onClose: () => void;
  reason?: string;
};

type Mode = 'login' | 'signup';

export default function AuthModal({ open, onClose, reason }: AuthModalProps) {
  const { configured } = useAuth();
  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ageOk, setAgeOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!open) return null;

  const submit = async () => {
    setError('');
    setNotice('');

    if (!configured) {
      setError('Accounts are not enabled yet — Supabase keys are being configured.');
      return;
    }
    if (mode === 'signup' && !ageOk) {
      setError('You must confirm you are 21 or older.');
      return;
    }

    setLoading(true);
    try {
      const supabase = getBrowserSupabase();
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (!data.session) {
          setNotice('Check your email to confirm your account, then log in.');
          setMode('login');
        } else {
          onClose();
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="animate-fade-up pg-card relative w-full max-w-md p-7 sm:p-8">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 p-1 text-zinc-500 hover:text-zinc-300"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/25">
            <ShieldCheck className="h-5 w-5 text-emerald-950" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">
              {mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="text-xs text-zinc-500">
              {reason ?? 'Track picks, save history, and unlock Pro.'}
            </p>
          </div>
        </div>

        {!configured && (
          <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-300">
            Accounts aren&apos;t live yet — add Supabase keys to enable sign-in. The form is
            fully wired and will work the moment keys are set.
          </div>
        )}

        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
            className="w-full rounded-xl border border-white/[0.08] bg-black/30 px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="w-full rounded-xl border border-white/[0.08] bg-black/30 px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />

          {mode === 'signup' && (
            <label className="flex items-start gap-2.5 py-1 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={ageOk}
                onChange={(e) => setAgeOk(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-emerald-500"
              />
              <span>
                I am 21+ and understand SLIPPR provides informational analysis for
                entertainment only — not betting advice or guaranteed outcomes.
              </span>
            </label>
          )}

          {error && <p className="text-xs text-rose-400">{error}</p>}
          {notice && <p className="text-xs text-emerald-400">{notice}</p>}

          <button onClick={submit} disabled={loading} className="btn-primary w-full py-3">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </div>

        <p className="mt-5 text-center text-xs text-zinc-500">
          {mode === 'signup' ? 'Already have an account?' : 'New to SLIPPR?'}{' '}
          <button
            onClick={() => {
              setMode(mode === 'signup' ? 'login' : 'signup');
              setError('');
              setNotice('');
            }}
            className="font-medium text-emerald-400 hover:text-emerald-300"
          >
            {mode === 'signup' ? 'Log in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  );
}
