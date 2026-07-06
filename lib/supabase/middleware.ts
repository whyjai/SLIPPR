import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured, getSupabaseEnv } from './config';

/**
 * Refreshes the Supabase auth session on each request and writes updated
 * auth cookies onto the response. No-op when Supabase is not configured.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured()) return response;

  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Touch the user to trigger a token refresh when needed.
  try {
    await supabase.auth.getUser();
  } catch {
    // network hiccup — let the request through, client will retry
  }

  return response;
}
