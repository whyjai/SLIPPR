import { NextResponse } from 'next/server';
import { getRecentStaleAlerts } from '@/lib/stale-lines';
import { isPro, PRIVATE_CACHE } from '@/lib/entitlement';

// Read-only — never touches the Odds API. Powers the "Stale Line Alerts" card.
// Pro only: free users get the count so the card can show what's locked.
export async function GET() {
  const [alerts, pro] = await Promise.all([getRecentStaleAlerts(20), isPro()]);
  return NextResponse.json(pro ? { alerts } : { alerts: [], locked: alerts.length }, { headers: PRIVATE_CACHE });
}
