import { NextResponse } from 'next/server';
import { getPublishedBoard, type BoardLeg } from '@/lib/leg-board';
import { FREE_LIMITS, isPro, PRIVATE_CACHE } from '@/lib/entitlement';

// Read-only: returns the latest cron-generated board. Never scans odds or runs
// the council, so it's fast and users can't trigger a refresh.
export async function GET() {
  const [board, pro] = await Promise.all([getPublishedBoard(), isPro()]);
  if (pro) return NextResponse.json(board, { headers: PRIVATE_CACHE });

  // Free: the top takes in the board's default order (grade, then council confidence).
  const order: Record<BoardLeg['grade'], number> = { 'A+': 4, A: 3, 'B+': 2, B: 1, C: 0 };
  const takes = board.legs
    .filter((l) => l.grade !== 'C')
    .sort((a, b) => order[b.grade] - order[a.grade] || b.confidence - a.confidence);
  const legs = takes.slice(0, FREE_LIMITS.legs);

  return NextResponse.json({ ...board, legs, locked: takes.length - legs.length }, { headers: PRIVATE_CACHE });
}
