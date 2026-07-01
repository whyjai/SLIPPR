import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const user_id = searchParams.get('user_id');

  if (!user_id) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('bet_history')
    .select('*')
    .eq('user_id', user_id)
    .order('date', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const { user_id, slip } = await req.json();

  if (!user_id || !slip) {
    return NextResponse.json({ error: 'user_id and slip are required' }, { status: 400 });
  }

  const { error } = await supabase.from('bet_history').insert({ user_id, slip });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
