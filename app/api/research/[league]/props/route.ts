import { NextResponse } from 'next/server';
import { isLeague, LEAGUES } from '@/lib/research/hoops-data';
import { getHoopsPropSheet } from '@/lib/research/hoops-props';

// Basketball prop cheat sheet for the next slate. Box scores update daily and the
// injury report through the day, so cache for 30 minutes.
export async function GET(_req: Request, { params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  if (!isLeague(league)) return NextResponse.json({ error: 'Unknown league' }, { status: 404 });
  try {
    const data = await getHoopsPropSheet(league);
    return NextResponse.json(data, { headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=3600' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `${LEAGUES[league].name} prop sheet unavailable: ${message}` }, { status: 502 });
  }
}
