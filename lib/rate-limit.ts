import { NextResponse } from 'next/server';

const RATE_LIMITS = {
  '/api/cron': 5,
  '/api/auth': 10,
  '/api/bot': 20,
  default: 100,
};

export function rateLimit(req: Request) {
  const path = new URL(req.url).pathname;
  const limit =
    RATE_LIMITS[path as keyof typeof RATE_LIMITS] ?? RATE_LIMITS.default;

  console.log(`Rate limit check for ${path}: ${limit}/min`);

  return NextResponse.next();
}
