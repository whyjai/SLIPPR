'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseEnv } from './config';

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/** Singleton browser Supabase client (cookie-backed session). */
export function getBrowserSupabase() {
  if (browserClient) return browserClient;
  const { url, anonKey } = getSupabaseEnv();
  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}
