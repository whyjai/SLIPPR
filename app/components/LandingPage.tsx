'use client';

import Link from 'next/link';
import { Shield, Users, TrendingUp, Award } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="pt-24 pb-16 text-center px-6">
        <div className="inline-flex items-center gap-2 bg-zinc-900 px-4 py-2 rounded-full mb-6">
          <Shield className="text-emerald-500" /> SLIPPR · AI-Powered Protection
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tighter mb-6">
          Beat the Books.
          <br />
          With Confidence.
        </h1>
        <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
          Daily graded parlay slips. AI Council consensus. Predatory line warnings. Real edge
          with peace of mind.
        </p>
        <div className="mt-10 flex flex-wrap gap-4 justify-center">
          <Link
            href="/dashboard"
            className="bg-emerald-600 hover:bg-emerald-500 px-10 py-4 rounded-2xl text-lg font-semibold"
          >
            Start Free (Limited Slips)
          </Link>
          <a
            href="#pricing"
            className="border border-zinc-700 hover:bg-zinc-900 px-10 py-4 rounded-2xl text-lg font-semibold"
          >
            See Pricing
          </a>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-3 gap-8">
        <div className="card bg-zinc-900 p-8 rounded-3xl">
          <Award className="w-12 h-12 text-emerald-500 mb-6" />
          <h3 className="text-2xl font-semibold mb-3">AI Council</h3>
          <p className="text-zinc-400">
            10 models debate every leg. Full transparency on grading.
          </p>
        </div>

        <div className="card bg-zinc-900 p-8 rounded-3xl">
          <TrendingUp className="w-12 h-12 text-emerald-500 mb-6" />
          <h3 className="text-2xl font-semibold mb-3">Sharp vs Public</h3>
          <p className="text-zinc-400">See where sharp money is vs public. Avoid traps.</p>
        </div>

        <div className="card bg-zinc-900 p-8 rounded-3xl">
          <Users className="w-12 h-12 text-emerald-500 mb-6" />
          <h3 className="text-2xl font-semibold mb-3">Community + Referrals</h3>
          <p className="text-zinc-400">Share wins. Earn free months. Real user feedback.</p>
        </div>
      </div>

      <div id="pricing" className="bg-zinc-900 py-20">
        <div className="max-w-4xl mx-auto text-center px-6">
          <h2 className="text-4xl font-bold mb-4">Simple Pricing. Real Value.</h2>
          <div className="grid md:grid-cols-2 gap-6 mt-12 max-w-2xl mx-auto">
            <div className="card bg-zinc-950 p-8 rounded-3xl border border-zinc-800">
              <div className="text-emerald-400">Free</div>
              <div className="text-5xl font-bold my-4">$0</div>
              <ul className="text-left space-y-3 text-sm">
                <li>✓ 3 Safe Slips/day</li>
                <li>✓ Basic warnings</li>
              </ul>
              <Link
                href="/dashboard"
                className="mt-6 block w-full bg-zinc-800 hover:bg-zinc-700 py-3 rounded-xl font-semibold"
              >
                Get Started
              </Link>
            </div>

            <div className="card bg-emerald-600 p-8 rounded-3xl md:relative md:-top-4 md:scale-105">
              <div className="text-emerald-200">Premium</div>
              <div className="text-5xl font-bold my-4">$19</div>
              <ul className="text-left space-y-3 text-sm">
                <li>✓ All 20+ Slips</li>
                <li>✓ AI Council Full View</li>
                <li>✓ Bankroll Tools</li>
                <li>✓ Referrals</li>
              </ul>
              <Link
                href="/dashboard"
                className="mt-6 block w-full bg-emerald-700 hover:bg-emerald-800 py-3 rounded-xl font-semibold"
              >
                Go Premium
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
