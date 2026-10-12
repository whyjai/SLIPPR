import { NextResponse } from 'next/server';
import { isLeague, LEAGUES, latestSeason } from '@/lib/research/hoops-data';
import { getHoopsResearch } from '@/lib/research/hoops-defense';

// Basketball research (NBA, WNBA): ESPN box scores via sportsdataverse. Box scores
// update daily in season, so an hour of CDN caching is plenty. /nfl has its own routes.
export async function GET(req: Request, { params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  if (!isLeague(league)) return NextResponse.json({ error: 'Unknown league' }, { status: 404 });
  const param = Number(new URL(req.url).searchParams.get('season'));
  try {
    const season = Number.isInteger(param) && param >= 2003 && param <= 2100 ? param : await latestSeason(league);
    const data = await getHoopsResearch(league, season);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=21600' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `${LEAGUES[league].name} research unavailable: ${message}` }, { status: 502 });
  }
}
