import { NextResponse } from 'next/server';
import { getNflPlayerTrends } from '@/lib/research/nfl-players';

// Player usage and production trends (box scores + snap counts only).
export async function GET(req: Request) {
  const param = Number(new URL(req.url).searchParams.get('season'));
  const season = Number.isInteger(param) && param >= 2001 && param <= 2100 ? param : new Date().getFullYear();
  try {
    const data = await getNflPlayerTrends(season);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=21600' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `NFL player data unavailable: ${message}` }, { status: 502 });
  }
}
