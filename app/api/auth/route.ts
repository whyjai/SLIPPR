import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Sign-in is not configured yet. Add Supabase keys to enable accounts.' },
      { status: 503 },
    );
  }

  const { email, password, action } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const supabase = await getServerSupabase();

  if (action === 'signup') {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ user: data.user, needsConfirmation: !data.session });
  }

  if (action === 'login') {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ user: data.user });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
