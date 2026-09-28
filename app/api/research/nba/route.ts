import { NextResponse } from 'next/server';
import { latestNbaSeason } from '@/lib/research/nba-data';
import { getNbaResearch } from '@/lib/research/nba-defense';

// Public research data (ESPN box scores via sportsdataverse). Box scores update
// daily in season, so an hour of CDN caching is plenty.
export async function GET(req: Request) {
  const param = Number(new URL(req.url).searchParams.get('season'));
  try {
    const season = Number.isInteger(param) && param >= 2003 && param <= 2100 ? param : await latestNbaSeason();
    const data = await getNbaResearch(season);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=21600' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `NBA research unavailable: ${message}` }, { status: 502 });
  }
}
