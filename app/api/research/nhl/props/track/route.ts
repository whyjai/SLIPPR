import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

// How the NHL prop cheat sheet has done, graded daily by
// scripts/research/grade-nhl-sheet.mts (GitHub Actions) into the repo.
export async function GET() {
  try {
    const text = await readFile(join(process.cwd(), 'data/research/prop-sheets/nhl-track.json'), 'utf8');
    return new NextResponse(text, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=1800, stale-while-revalidate=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'No track record yet' }, { status: 404 });
  }
}
