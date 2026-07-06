'use client';

import Link from 'next/link';
import { Shield, Users, TrendingUp, Award, ArrowRight } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white overflow-hidden">
      <nav className="fixed top-0 w-full bg-zinc-950/80 backdrop-blur-lg border-b border-zinc-800 z-50">
        <div className="max-w-6xl mx-auto px-6 py-5 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-emerald-500" />
            <span className="font-bold text-2xl tracking-tight">SLIPPR</span>
          </div>
          <div className="flex gap-8 text-sm">
            <a href="#features" className="hover:text-emerald-400 transition-colors">
              Features
            </a>
            <a href="#pricing" className="hover:text-emerald-400 transition-colors">
              Pricing
            </a>
            <Link href="/dashboard" className="text-emerald-400 font-medium">
              Dashboard →
            </Link>
          </div>
        </div>
      </nav>

      <div className="pt-32 pb-24 text-center px-6">
        <div className="inline-flex items-center gap-2 bg-zinc-900 px-5 py-2 rounded-full mb-8 text-sm">
          <span className="text-emerald-400">●</span> Live AI Council Running
        </div>
        <h1 className="text-5xl sm:text-7xl font-bold tracking-tighter mb-6">
          Daily Edge.
          <br />
          Real Protection.
        </h1>
        <p className="text-xl sm:text-2xl text-zinc-400 max-w-3xl mx-auto">
          AI-powered parlay slips. Council consensus. Predatory line warnings.
          <br />
          Built for serious bettors.
        </p>
        <div className="mt-12 flex gap-4 justify-center">
          <Link
            href="/dashboard"
            className="bg-emerald-600 hover:bg-emerald-500 px-10 py-4 rounded-2xl text-lg font-semibold flex items-center gap-3 group"
          >
            Try Free Now{' '}
            <ArrowRight className="group-hover:translate-x-1 transition" />
          </Link>
        </div>
      </div>

      <div id="features" className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-zinc-900 p-10 rounded-3xl card">
            <Award className="w-12 h-12 text-emerald-500 mb-8" />
            <h3 className="text-3xl font-semibold mb-4">AI Council</h3>
            <p className="text-zinc-400 leading-relaxed">
              10 models debate every leg. Full transparency + consensus on best slips.
            </p>
          </div>
          <div className="bg-zinc-900 p-10 rounded-3xl card">
            <TrendingUp className="w-12 h-12 text-emerald-500 mb-8" />
            <h3 className="text-3xl font-semibold mb-4">Sharp vs Public</h3>
            <p className="text-zinc-400 leading-relaxed">
              See where smart money is vs public. Avoid traps.
            </p>
          </div>
          <div className="bg-zinc-900 p-10 rounded-3xl card">
            <Users className="w-12 h-12 text-emerald-500 mb-8" />
            <h3 className="text-3xl font-semibold mb-4">Community Edge</h3>
            <p className="text-zinc-400 leading-relaxed">
              Referrals, comments, and shared wins. Built for serious bettors.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
