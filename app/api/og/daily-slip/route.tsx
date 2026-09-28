import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPropEdges } from '@/lib/prop-edges';
import { buildDailySlip, EmptySlipGraphic, SlipGraphic } from '@/lib/slip-graphic';

export const dynamic = 'force-dynamic';

const FONT_FILES = [
  ['Geist', 'Geist-500.ttf', 500],
  ['Geist', 'Geist-600.ttf', 600],
  ['Geist', 'Geist-700.ttf', 700],
  ['Geist', 'Geist-800.ttf', 800],
  ['Geist Mono', 'GeistMono-500.ttf', 500],
  ['Geist Mono', 'GeistMono-600.ttf', 600],
  ['Geist Mono', 'GeistMono-700.ttf', 700],
] as const;

type OgFont = { name: string; data: Buffer; weight: 500 | 600 | 700 | 800; style: 'normal' };

// Read once per server instance.
let fontsPromise: Promise<OgFont[]> | null = null;

function loadFonts(): Promise<OgFont[]> {
  fontsPromise ??= Promise.all(
    FONT_FILES.map(async ([name, file, weight]) => ({
      name,
      data: await readFile(join(process.cwd(), 'assets/fonts', file)),
      weight,
      style: 'normal' as const,
    })),
  );
  return fontsPromise;
}

/**
 * Daily promo graphic (1080×1350) built from the latest Prop Edges scan.
 * Gated by PROMO_GRAPHIC_KEY (?key=) because it shows the full slip, which is
 * more than the free tier sees; open in local dev when the key is unset.
 */
export async function GET(req: Request) {
  const expected = process.env.PROMO_GRAPHIC_KEY;
  const key = new URL(req.url).searchParams.get('key');
  const devOpen = !expected && process.env.NODE_ENV !== 'production';
  if (!devOpen && (!expected || key !== expected)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const slip = buildDailySlip(await getPropEdges());

  return new ImageResponse(slip ? <SlipGraphic slip={slip} /> : <EmptySlipGraphic />, {
    width: 1080,
    height: 1350,
    fonts: await loadFonts(),
    headers: {
      // Private: the URL carries the key, so keep it out of shared caches.
      'Cache-Control': 'private, max-age=300',
    },
  });
}
