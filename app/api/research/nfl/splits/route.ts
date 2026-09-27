import { NextResponse } from 'next/server';
import { mergedSplits, summarizeSplits } from '@/lib/research/nfl-teams';

// One player's splits vs. defensive looks (blitz, box, coverage, play-action), last season + this season.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const param = Number(url.searchParams.get('season'));
  const season = Number.isInteger(param) && param >= 2022 && param <= 2100 ? param : new Date().getFullYear();
  const player = url.searchParams.get('player') ?? '';
  if (!/^[\w-]{4,20}$/.test(player)) return NextResponse.json({ error: 'player id required' }, { status: 400 });
  try {
    const splits = summarizeSplits(player, await mergedSplits(season));
    return NextResponse.json(splits ?? { playerId: player, seasons: [], passing: [], receiving: [], rushing: [] }, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=21600' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `NFL play-by-play unavailable: ${message}` }, { status: 502 });
  }
}
