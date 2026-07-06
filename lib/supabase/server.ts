import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseEnv } from './config';

/**
 * Server-side Supabase client bound to the request cookies. Use in route
 * handlers and server components to read the authenticated user.
 */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // called from a Server Component — safe to ignore, middleware refreshes
        }
      },
    },
  });
}
