/**
 * Whether real Supabase credentials are configured. When false, the app runs
 * in "auth demo" mode: the UI renders but sign-in is disabled with a clear
 * setup prompt instead of throwing.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && key && !url.includes('placeholder') && !key.includes('placeholder'));
}

export function getSupabaseEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key',
  };
}
