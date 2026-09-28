import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// The user is always the signed-in session, never an id from the request —
// otherwise anyone could read or write anyone's history.
async function sessionUserId(): Promise<string | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

const unauthorized = () => NextResponse.json({ error: 'Sign in to see your history.' }, { status: 401 });

export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();

  const { data, error } = await getSupabaseAdmin()
    .from('bet_history')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) return NextResponse.json({ error: 'Could not load history.' }, { status: 500 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: Request) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();

  const { slip } = await req.json();
  if (!slip) return NextResponse.json({ error: 'slip is required' }, { status: 400 });

  const { error } = await getSupabaseAdmin().from('bet_history').insert({ user_id: userId, slip });
  if (error) return NextResponse.json({ error: 'Could not save slip.' }, { status: 500 });
  return NextResponse.json({ success: true });
}
