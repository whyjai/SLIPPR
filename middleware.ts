import type { NextRequest } from 'next/server';
import { rateLimit } from './lib/rate-limit';

export function middleware(request: NextRequest) {
  return rateLimit(request);
}

export const config = {
  matcher: ['/api/:path*'],
};
