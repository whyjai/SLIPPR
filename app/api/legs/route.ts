import { NextResponse } from 'next/server';
import { getPublishedBoard } from '@/lib/leg-board';

// Read-only: returns the latest cron-generated board. Never scans odds or runs
// the council, so it's fast and users can't trigger a refresh.
export async function GET() {
  const board = await getPublishedBoard();

  return NextResponse.json(board, {
    headers: {
      'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
    },
  });
}
