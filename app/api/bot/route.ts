import { NextResponse } from 'next/server';
import { ParlayEngine } from '@/lib/parlay-engine';

export async function GET() {
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
  });
}
