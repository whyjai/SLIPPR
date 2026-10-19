import { NextResponse } from 'next/server';
import { getNhlPropSheet } from '@/lib/research/nhl-props';

// NHL prop cheat sheet for the next slate. Game logs update overnight and the
// injury report through the day, so cache for 30 minutes.
export async function GET() {
  try {
    const data = await getNhlPropSheet();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 's-maxage=1800, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `NHL prop sheet unavailable: ${message}` }, { status: 502 });
  }
}
