import { NextResponse } from 'next/server';
import { latestMlbSeason } from '@/lib/research/mlb-data';
import { getMlbPlayerTrends } from '@/lib/research/mlb-research';

// MLB research: play-by-play (sportsdataverse) + MLB StatsAPI. Updated daily in season.
export async function GET(req: Request) {
  const param = Number(new URL(req.url).searchParams.get('season'));
  try {
    const season = Number.isInteger(param) && param >= 2008 && param <= 2100 ? param : await latestMlbSeason();
    const data = await getMlbPlayerTrends(season);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=21600' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `MLB player trends unavailable: ${message}` }, { status: 502 });
  }
}
