import { NextResponse } from 'next/server';
import { getNflResearch } from '@/lib/research/nfl-defense';

// Public research data (box scores only). nflverse updates after each game day,
// so an hour of CDN caching is plenty.
export async function GET(req: Request) {
  const param = Number(new URL(req.url).searchParams.get('season'));
  const season = Number.isInteger(param) && param >= 2000 && param <= 2100 ? param : new Date().getFullYear();
  try {
    const data = await getNflResearch(season);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=21600' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `NFL data unavailable: ${message}` }, { status: 502 });
  }
}
