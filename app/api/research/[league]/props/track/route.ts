import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { isLeague } from '@/lib/research/hoops-data';

// How a basketball prop cheat sheet has done, graded daily by
// scripts/research/grade-hoops-sheet.mts (GitHub Actions) into the repo.
export async function GET(_req: Request, { params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  if (!isLeague(league)) return NextResponse.json({ error: 'Unknown league' }, { status: 404 });
  try {
    const text = await readFile(join(process.cwd(), 'data/research/prop-sheets', `${league}-track.json`), 'utf8');
    return new NextResponse(text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=1800, stale-while-revalidate=3600' } });
  } catch {
    return NextResponse.json({ error: 'No track record yet' }, { status: 404 });
  }
}
