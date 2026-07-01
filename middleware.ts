import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRateLimitConfig, isRateLimited } from '@/lib/rate-limit';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const config = getRateLimitConfig(pathname);
  const key = `${ip}:${pathname}`;

  if (isRateLimited(key, config)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(config.windowMs / 1000)) },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
