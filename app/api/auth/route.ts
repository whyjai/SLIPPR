import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { email, password, action } = await req.json();

  if (action === 'signup') {
    const { data, error } = await supabase.auth.signUp({ email, password });
    return NextResponse.json({ data, error });
  }

  if (action === 'login') {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return NextResponse.json({ data, error });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
