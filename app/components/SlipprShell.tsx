'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BadgeCheck,
  History,
  Home,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  User as UserIcon,
  X,
} from 'lucide-react';
import LandingView from './premium/LandingView';
import DashboardView from './premium/DashboardView';
import LegBoardView from './premium/LegBoardView';
import SlipBuilderView from './premium/SlipBuilderView';
import HistoryView from './premium/HistoryView';
import SharpView from './premium/SharpView';
import SettingsView from './premium/SettingsView';
import TrackRecordView from './premium/TrackRecordView';
import { UpgradeProvider, useUpgrade } from './UpgradeProvider';
import { useAuth } from './AuthProvider';

type Tab =
  | 'home'
  | 'dashboard'
  | 'board'
  | 'builder'
  | 'track'
  | 'history'
  | 'sharp'
  | 'settings';

const TAB_PARAM_MAP: Record<string, Tab> = {
  home: 'home',
  dashboard: 'dashboard',
  board: 'board',
  builder: 'builder',
  track: 'track',
  history: 'history',
  sharp: 'sharp',
  settings: 'settings',
};

type NavEntry = {
  tab: Tab;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const platformNav: NavEntry[] = [
  { tab: 'home', label: 'Home', icon: Home },
  { tab: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { tab: 'board', label: 'Leg Board', icon: ListOrdered },
  { tab: 'builder', label: 'Slip Builder', icon: SlidersHorizontal },
];

const analysisNav: NavEntry[] = [
  { tab: 'track', label: 'Track Record', icon: BadgeCheck },
  { tab: 'history', label: 'History', icon: History },
  { tab: 'sharp', label: 'Sharp vs Public', icon: TrendingUp },
];

export default function SlipprShell() {
  return (
    <UpgradeProvider>
      <ShellInner />
    </UpgradeProvider>
  );
}

function ShellInner() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && TAB_PARAM_MAP[tab]) {
      setActiveTab(TAB_PARAM_MAP[tab]);
    }
  }, [searchParams]);

  const goTo = (tab: Tab) => {
    setActiveTab(tab);
    setMobileOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-background text-white">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed z-50 flex h-screen w-[264px] flex-col border-r border-white/[0.06] bg-[#0a0a0c]/95 backdrop-blur-xl transition-transform duration-300 md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-6 pb-6 pt-7">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/25">
            <ShieldCheck className="h-5 w-5 text-emerald-950" />
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-tight">SLIPPR</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600">
              AI Parlay Intelligence
            </div>
          </div>
          <button
            type="button"
            className="ml-auto p-1 text-zinc-500 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-7 overflow-y-auto px-4 pt-2">
          <NavGroup label="Platform">
            {platformNav.map((entry) => (
              <NavItem
                key={entry.tab}
                {...entry}
                active={activeTab === entry.tab}
                onClick={() => goTo(entry.tab)}
              />
            ))}
          </NavGroup>

          <NavGroup label="Analysis">
            {analysisNav.map((entry) => (
              <NavItem
                key={entry.tab}
                {...entry}
                active={activeTab === entry.tab}
                onClick={() => goTo(entry.tab)}
              />
            ))}
          </NavGroup>
        </nav>

        {/* Footer */}
        <div className="space-y-3 border-t border-white/[0.06] p-4">
          <UserMenu />
          <NavItem
            tab="settings"
            label="Settings"
            icon={Settings}
            active={activeTab === 'settings'}
            onClick={() => goTo('settings')}
          />
        </div>
      </aside>

      {/* Main */}
      <div className="min-w-0 flex-1 md:ml-[264px]">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/[0.06] bg-background/90 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="p-2 text-zinc-400"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-b from-emerald-400 to-emerald-600">
            <ShieldCheck className="h-4 w-4 text-emerald-950" />
          </div>
          <span className="font-semibold tracking-tight">SLIPPR</span>
        </div>

        <main key={activeTab} className="animate-fade-up">
          {activeTab === 'home' && (
            <LandingView
              onOpenDashboard={() => goTo('dashboard')}
              onOpenBoard={() => goTo('board')}
            />
          )}
          {activeTab === 'dashboard' && <DashboardView embedded />}
          {activeTab === 'board' && <LegBoardView />}
          {activeTab === 'builder' && <SlipBuilderView />}
          {activeTab === 'track' && <TrackRecordView />}
          {activeTab === 'history' && <HistoryView />}
          {activeTab === 'sharp' && <SharpView onOpenDashboard={() => goTo('dashboard')} />}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

function UserMenu() {
  const { loading, user, isPro, signOut } = useAuth();
  const { requireAuth } = useUpgrade();

  if (loading) {
    return <div className="skeleton h-[52px]" />;
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => requireAuth()}
        className="flex w-full items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/15"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05]">
          <UserIcon className="h-4 w-4 text-zinc-400" />
        </div>
        <div>
          <div className="text-xs font-medium text-zinc-200">Log in / Sign up</div>
          <div className="text-[11px] text-zinc-600">Track picks & unlock Pro</div>
        </div>
      </button>
    );
  }

  const email = user.email ?? 'Account';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
        {isPro ? <BadgeCheck className="h-4 w-4" /> : <UserIcon className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-zinc-200">{email}</div>
        <div className="text-[11px] text-zinc-500">{isPro ? 'Pro member' : 'Free plan'}</div>
      </div>
      <button
        type="button"
        onClick={() => void signOut()}
        className="p-1.5 text-zinc-500 transition hover:text-zinc-300"
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">
        {label}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

type NavItemProps = {
  tab: Tab;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
};

function NavItem({ icon: Icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-all duration-200 ${
        active
          ? 'bg-emerald-500/10 text-emerald-300'
          : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-emerald-400" />
      )}
      <Icon
        className={`h-4 w-4 shrink-0 transition-colors ${
          active ? 'text-emerald-400' : 'text-zinc-500 group-hover:text-zinc-300'
        }`}
      />
      {label}
    </button>
  );
}
