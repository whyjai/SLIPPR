import { NextResponse } from 'next/server';
import { gradeLegsForModel } from '@/lib/model-grades';
import type { SportsData } from '@/lib/types';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ model: string }> },
) {
  const { model } = await params;
  const { data } = await req.json();

  const grades = gradeLegsForModel(model, data as SportsData);

  return NextResponse.json({ model, grades });
}
