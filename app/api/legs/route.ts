import { NextResponse } from 'next/server';
import { getLegBoard } from '@/lib/leg-board';

// Cold generation runs the council (up to ~50s) + odds scan; keep the function
// alive past Vercel's 60s default. The CDN cache (below) means most requests
// never trigger a cold generation.
export const maxDuration = 120;

export async function GET() {
  const board = await getLegBoard();

  return NextResponse.json(board, {
    headers: {
      'Cache-Control': 's-maxage=900, stale-while-revalidate=300',
    },
  });
}
