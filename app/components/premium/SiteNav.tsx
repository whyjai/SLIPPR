'use client';

import { Shield, Menu, X } from 'lucide-react';
import { useState } from 'react';

type SiteNavProps = {
  activeTab: 'landing' | 'dashboard';
  onTabChange: (tab: 'landing' | 'dashboard') => void;
};

export default function SiteNav({ activeTab, onTabChange }: SiteNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <button
            onClick={() => onTabChange('landing')}
            className="flex items-center gap-2.5 group"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/30 group-hover:bg-emerald-500/20 transition">
              <Shield className="h-5 w-5 text-emerald-400" />
            </div>
            <span className="text-lg font-semibold tracking-tight">SLIPPR</span>
          </button>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium">
            <button
              onClick={() => onTabChange('landing')}
              className={activeTab === 'landing' ? 'text-emerald-400' : 'text-zinc-400 hover:text-white transition'}
            >
              Home
            </button>
            <button
              onClick={() => onTabChange('dashboard')}
              className={activeTab === 'dashboard' ? 'text-emerald-400' : 'text-zinc-400 hover:text-white transition'}
            >
              Dashboard
            </button>
            <button
              onClick={() => onTabChange('dashboard')}
              className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 transition shadow-lg shadow-emerald-500/20"
            >
              Run Bot
            </button>
          </div>

          <button
            className="md:hidden p-2 text-zinc-400"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {open && (
          <div className="md:hidden pb-4 space-y-2">
            <button
              onClick={() => { onTabChange('landing'); setOpen(false); }}
              className="block w-full text-left px-3 py-2 rounded-lg hover:bg-white/5"
            >
              Home
            </button>
            <button
              onClick={() => { onTabChange('dashboard'); setOpen(false); }}
              className="block w-full text-left px-3 py-2 rounded-lg hover:bg-white/5"
            >
              Dashboard
            </button>
            <button
              onClick={() => { onTabChange('dashboard'); setOpen(false); }}
              className="w-full rounded-full bg-emerald-500 py-2.5 font-semibold text-zinc-950"
            >
              Run Bot
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
