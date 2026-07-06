'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, TrendingUp } from 'lucide-react';
import { Card, PageHeader, SectionLabel } from './ui';
import type { BotResponse } from './types';

type SharpData = NonNullable<BotResponse['sharpPublic']>;

type SharpViewProps = {
  onOpenDashboard: () => void;
};

export default function SharpView({ onOpenDashboard }: SharpViewProps) {
  const [data, setData] = useState<SharpData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/bot');
        if (!res.ok || cancelled) return;
        const json: BotResponse = await res.json();
        if (!cancelled && json.sharpPublic) setData(json.sharpPublic);
      } catch {
        // fall through to empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const maxEdge = data
    ? Math.max(...data.sharpLegs.map((l) => l.edge), 1)
    : 1;

  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Market Intelligence"
          title="Sharp vs Public"
          description="Where smart money flows — and where the public is being farmed. Updated with every council run."
        />

        {loading ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="skeleton h-80" />
            <div className="skeleton h-80" />
          </div>
        ) : !data ? (
          <Card className="animate-fade-up p-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <TrendingUp className="h-7 w-7 text-emerald-400" />
            </div>
            <p className="mb-2 font-medium text-zinc-300">No sharp/public data yet</p>
            <p className="mx-auto mb-8 max-w-sm text-sm text-zinc-600">
              Run the bot to pull live market splits and see where the edge is.
            </p>
            <button onClick={onOpenDashboard} className="btn-primary px-7 py-3">
              Run Bot on Dashboard <ArrowRight className="h-4 w-4" />
            </button>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Sharp side */}
            <Card className="animate-fade-up delay-75 p-7 sm:p-8">
              <div className="mb-6 flex items-center gap-2.5">
                <TrendingUp className="h-5 w-5 text-emerald-400" />
                <h2 className="text-lg font-semibold">Sharp Money</h2>
              </div>
              <SectionLabel className="mb-4">Follow the edge</SectionLabel>
              <div className="space-y-3">
                {data.sharpLegs.length === 0 && (
                  <p className="py-6 text-center text-sm text-zinc-600">
                    No sharp edges detected on this slate yet.
                  </p>
                )}
                {data.sharpLegs.map((leg, i) => (
                  <div
                    key={i}
                    className="animate-fade-up rounded-xl border border-white/[0.05] bg-black/25 p-4"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-4">
                      <span className="text-sm text-zinc-200">{leg.name}</span>
                      <span className="shrink-0 font-mono text-sm font-semibold text-emerald-400">
                        +{leg.edge}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700"
                        style={{ width: `${(leg.edge / maxEdge) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Public side */}
            <Card className="animate-fade-up delay-150 border-rose-500/15 p-7 sm:p-8">
              <div className="mb-6 flex items-center gap-2.5">
                <AlertTriangle className="h-5 w-5 text-rose-400" />
                <h2 className="text-lg font-semibold">Public Heavy</h2>
              </div>
              <SectionLabel className="mb-4 !text-rose-400">Traps to avoid</SectionLabel>
              <div className="space-y-3">
                {data.publicLegs.length === 0 && (
                  <p className="py-6 text-center text-sm text-zinc-600">
                    No public traps flagged right now.
                  </p>
                )}
                {data.publicLegs.map((leg, i) => (
                  <div
                    key={i}
                    className="animate-fade-up flex items-center justify-between gap-4 rounded-xl border border-rose-500/10 bg-rose-500/[0.04] p-4"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <span className="text-sm text-zinc-300">{leg.name}</span>
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-rose-400">
                      Avoid · High Juice
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
