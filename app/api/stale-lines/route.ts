import { NextResponse } from 'next/server';
import { getRecentStaleAlerts } from '@/lib/stale-lines';

// Read-only — never touches the Odds API. Powers the "Stale Line Alerts" card.
export async function GET() {
  const alerts = await getRecentStaleAlerts(20);

  return NextResponse.json(
    { alerts },
    { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' } },
  );
}
