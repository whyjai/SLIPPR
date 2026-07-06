import { NextResponse } from 'next/server';
import { getTrackRecord } from '@/lib/track-record';

export const dynamic = 'force-dynamic';

export async function GET() {
  const summary = await getTrackRecord();

  if (!summary) {
    return NextResponse.json({ configured: false, summary: null });
  }

  return NextResponse.json(
    { configured: true, summary },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=120' } },
  );
}
