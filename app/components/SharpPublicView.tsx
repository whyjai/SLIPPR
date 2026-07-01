'use client';

import { TrendingUp } from 'lucide-react';
import type { SharpPublicData } from '@/lib/sharp-public';

export function SharpPublicView({ data }: { data: SharpPublicData }) {
  return (
    <div className="card bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
      <h3 className="text-xl font-bold mb-6 flex items-center gap-3">
        <TrendingUp className="text-emerald-500" /> Sharp vs Public
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        <div>
          <div className="text-emerald-400 text-sm mb-2">SHARP MONEY</div>
          <div className="space-y-4">
            {data.sharpLegs.map((leg, i) => (
              <div key={i} className="flex justify-between bg-zinc-800 p-4 rounded-2xl">
                <span>{leg.name}</span>
                <span className="text-emerald-400 font-medium">{leg.edge}% edge</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-red-400 text-sm mb-2">PUBLIC HEAVY</div>
          <div className="space-y-4">
            {data.publicLegs.map((leg, i) => (
              <div
                key={i}
                className="flex justify-between bg-zinc-800 p-4 rounded-2xl text-red-300"
              >
                <span>{leg.name}</span>
                <span className="font-medium">Avoid – High Juice</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
