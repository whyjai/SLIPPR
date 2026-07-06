import type { NextRequest } from 'next/server';
import { rateLimit } from './lib/rate-limit';
import { updateSession } from './lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  // API routes: keep the rate-limit pass (session cookies aren't needed there).
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return rateLimit(request);
  }

  // Page routes: refresh the Supabase session so auth stays live across nav.
  return updateSession(request);
}

export const config = {
  // Run on everything except static assets and image optimization.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
