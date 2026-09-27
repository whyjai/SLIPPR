import { NextResponse } from 'next/server';
import { getNflTeamTendencies } from '@/lib/research/nfl-teams';

// Team offensive/defensive tendencies from play-by-play + FTN charting.
export async function GET(req: Request) {
  const param = Number(new URL(req.url).searchParams.get('season'));
  const season = Number.isInteger(param) && param >= 2022 && param <= 2100 ? param : new Date().getFullYear();
  try {
    return NextResponse.json(await getNflTeamTendencies(season), {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=21600' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `NFL play-by-play unavailable: ${message}` }, { status: 502 });
  }
}
