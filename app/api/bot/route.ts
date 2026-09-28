import { NextResponse } from 'next/server';
import { ParlayEngine } from '@/lib/parlay-engine';
import { isPro, PRIVATE_CACHE, proRequired } from '@/lib/entitlement';

// Pro only — also keeps anonymous traffic from running the engine.
export async function GET() {
  if (!(await isPro())) return proRequired();
  const engine = new ParlayEngine();
  const result = await engine.generateDailySlips();

  return NextResponse.json({
    timestamp: result.date,
    slips: result.slips.map((slip) => ({
      tier: slip.tier,
      legs: slip.legs,
      odds: slip.odds,
      overallConfidence: slip.overall,
    })),
    warnings: result.warnings,
    sharpPublic: result.sharpPublic,
    councilConsensus: result.council,
    weeklyRankings: result.council.weeklyRankings,
    lastRefresh: result.lastRefresh.toISOString(),
  }, { headers: PRIVATE_CACHE });
}
