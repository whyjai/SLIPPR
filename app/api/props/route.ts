import { NextResponse } from 'next/server';
import { getPropEdges } from '@/lib/prop-edges';

// Latest stored prop scan. Read-only — scans run in the cron so page views
// never spend Odds API credits.
export async function GET() {
  const result = await getPropEdges();

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
    },
  });
}
