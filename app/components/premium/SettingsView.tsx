'use client';

import { useState } from 'react';
import { Bell, Loader2, Shield, Wallet } from 'lucide-react';
import { Card, IconTile, PageHeader, Toggle } from './ui';
import { useAuth } from '../AuthProvider';
import { useUpgrade } from '../UpgradeProvider';

export default function SettingsView() {
  const { user, isPro, configured, signOut } = useAuth();
  const { goPro, requireAuth, checkoutPending } = useUpgrade();
  const [emailSlips, setEmailSlips] = useState(true);
  const [predatoryAlerts, setPredatoryAlerts] = useState(true);
  const [sharpAlerts, setSharpAlerts] = useState(false);
  const [unitSize, setUnitSize] = useState('25');
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState('');

  const manageBilling = async () => {
    setBillingError('');
    setBillingBusy(true);
    try {
      const res = await fetch('/api/portal', { method: 'POST' });
      const data: { url?: string; error?: string } = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setBillingError(data.error ?? 'Could not open billing portal.');
    } catch {
      setBillingError('Could not reach billing portal.');
    } finally {
      setBillingBusy(false);
    }
  };

  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Preferences"
          title="Settings"
          description="Notifications, bankroll defaults, and account details."
        />

        <div className="space-y-6">
          {/* Notifications */}
          <Card className="animate-fade-up delay-75 p-7 sm:p-8">
            <div className="mb-6 flex items-center gap-4">
              <IconTile icon={Bell} />
              <div>
                <h2 className="font-semibold">Notifications</h2>
                <p className="text-sm text-zinc-500">
                  Delivered to your account email.
                </p>
              </div>
            </div>

            <div className="divide-y divide-white/[0.05]">
              <SettingRow
                title="Daily email slips"
                sub="Council picks delivered 8× daily, every 3 hours."
              >
                <Toggle checked={emailSlips} onChange={setEmailSlips} label="Daily email slips" />
              </SettingRow>
              <SettingRow
                title="Predatory line alerts"
                sub="Instant warning when a trap line is detected on your slate."
              >
                <Toggle
                  checked={predatoryAlerts}
                  onChange={setPredatoryAlerts}
                  label="Predatory line alerts"
                />
              </SettingRow>
              <SettingRow
                title="Sharp money movement"
                sub="Notify when sharp edge crosses 5% on a tracked market."
              >
                <Toggle checked={sharpAlerts} onChange={setSharpAlerts} label="Sharp money movement" />
              </SettingRow>
            </div>
          </Card>

          {/* Bankroll */}
          <Card className="animate-fade-up delay-150 p-7 sm:p-8">
            <div className="mb-6 flex items-center gap-4">
              <IconTile icon={Wallet} />
              <div>
                <h2 className="font-semibold">Bankroll defaults</h2>
                <p className="text-sm text-zinc-500">
                  Used by the bankroll calculator and slip sizing suggestions.
                </p>
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-300">
                Unit size (USD)
              </span>
              <div className="relative max-w-xs">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
                  $
                </span>
                <input
                  type="number"
                  min="1"
                  value={unitSize}
                  onChange={(e) => setUnitSize(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-black/30 py-3 pl-8 pr-4 font-mono text-sm text-zinc-200 transition focus:border-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </label>
          </Card>

          {/* Account & billing */}
          <Card className="animate-fade-up delay-225 p-7 sm:p-8">
            <div className="mb-6 flex items-center gap-4">
              <IconTile icon={Shield} />
              <div>
                <h2 className="font-semibold">Account & billing</h2>
                <p className="text-sm text-zinc-500">Plan, payment, and app details.</p>
              </div>
            </div>

            <div className="divide-y divide-white/[0.05]">
              <SettingRow
                title={user ? user.email ?? 'Account' : 'Not signed in'}
                sub={
                  !configured
                    ? 'Accounts activate once Supabase keys are set.'
                    : user
                      ? 'Signed in'
                      : 'Sign in to manage your plan.'
                }
              >
                {user ? (
                  <button onClick={() => void signOut()} className="btn-ghost px-5 py-2 text-sm">
                    Sign out
                  </button>
                ) : (
                  <button onClick={() => requireAuth()} className="btn-ghost px-5 py-2 text-sm">
                    Sign in
                  </button>
                )}
              </SettingRow>

              <SettingRow
                title="Current plan"
                sub={isPro ? 'Pro — full board, slip builder, all tools.' : 'Free — top 15 legs, basic warnings.'}
              >
                {isPro ? (
                  <button onClick={manageBilling} disabled={billingBusy} className="btn-ghost px-5 py-2 text-sm">
                    {billingBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Manage
                  </button>
                ) : (
                  <button onClick={() => void goPro()} disabled={checkoutPending} className="btn-primary px-5 py-2 text-sm">
                    {checkoutPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Upgrade — $19/mo
                  </button>
                )}
              </SettingRow>

              <SettingRow title="App URL" sub="slippr.vercel.app">
                <span />
              </SettingRow>
            </div>
            {billingError && <p className="mt-4 text-xs text-rose-400">{billingError}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function SettingRow({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <div>
        <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
        <p className="mt-0.5 text-sm text-zinc-500">{sub}</p>
      </div>
      {children}
    </div>
  );
}
