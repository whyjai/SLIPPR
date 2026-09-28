import { NextResponse } from 'next/server';
import { getPropEdges, type PropEdge } from '@/lib/prop-edges';
import { FREE_LIMITS, isPro, PRIVATE_CACHE } from '@/lib/entitlement';

// Latest stored prop scan. Read-only — scans run in the cron so page views
// never spend Odds API credits. Free users get the top plays only.
export async function GET() {
  const [result, pro] = await Promise.all([getPropEdges(), isPro()]);
  if (pro) return NextResponse.json(result, { headers: PRIVATE_CACHE });

  // Same grouping as the view: one play = event + player + market + side, ranked by its best edge.
  const plays = new Map<string, PropEdge[]>();
  for (const e of result.edges) {
    const k = `${e.event}|${e.player}|${e.market}|${e.side}`;
    plays.set(k, [...(plays.get(k) ?? []), e]);
  }
  const ranked = [...plays.values()].sort(
    (a, b) => Math.max(...b.map((e) => e.edge)) - Math.max(...a.map((e) => e.edge)),
  );
  const shown = ranked.slice(0, FREE_LIMITS.propEdges);

  return NextResponse.json(
    { ...result, edges: shown.flat(), locked: ranked.length - shown.length },
    { headers: PRIVATE_CACHE },
  );
}
