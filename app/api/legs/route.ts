import { NextResponse } from 'next/server';
import { getLegBoard } from '@/lib/leg-board';

export async function GET() {
  const board = await getLegBoard();

  return NextResponse.json(board, {
    headers: {
      'Cache-Control': 's-maxage=900, stale-while-revalidate=300',
    },
  });
}
