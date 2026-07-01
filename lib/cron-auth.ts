import { NextResponse } from 'next/server';

export function verifyCronRequest(req: Request): NextResponse | null {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '');

  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
