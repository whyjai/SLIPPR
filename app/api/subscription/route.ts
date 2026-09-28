import { NextResponse } from 'next/server';
import { getEntitlement, PRIVATE_CACHE } from '@/lib/entitlement';

export const dynamic = 'force-dynamic';

/** Returns the authenticated user's current subscription tier. */
export async function GET() {
  const { tier, status, authenticated, configured } = await getEntitlement();
  return NextResponse.json({ tier, status, authenticated, configured }, { headers: PRIVATE_CACHE });
}
