import { NextResponse } from 'next/server';
import { getNflPropSheet } from '@/lib/research/nfl-props';

// This week's NFL prop cheat sheet: run/pass defense context by position and
// calibrated outcome ranges for each player's prop stats. nflverse updates
// after each game day, so an hour of CDN caching is plenty.
export async function GET(req: Request) {
  const param = Number(new URL(req.url).searchParams.get('season'));
  const season = Number.isInteger(param) && param >= 2022 && param <= 2100 ? param : new Date().getFullYear();
  try {
    const data = await getNflPropSheet(season);
    return NextResponse.json(data, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=21600' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `NFL prop sheet unavailable: ${message}` }, { status: 502 });
  }
}
