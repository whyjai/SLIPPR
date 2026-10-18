import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

// How the NFL prop cheat sheet has done: graded weekly by
// scripts/research/grade-nfl-sheet.mts (GitHub Actions) into the repo.
export async function GET(req: Request) {
  const param = Number(new URL(req.url).searchParams.get('season'));
  const season = Number.isInteger(param) && param >= 2022 && param <= 2100 ? param : new Date().getFullYear();
  try {
    const text = await readFile(join(process.cwd(), 'data/research/prop-sheets', `${season}-track.json`), 'utf8');
    return new NextResponse(text, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=3600, stale-while-revalidate=21600' },
    });
  } catch {
    return NextResponse.json({ error: `No track record for ${season} yet` }, { status: 404 });
  }
}
