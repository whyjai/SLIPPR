import { NextResponse } from 'next/server';
import { gradeLegsForModel } from '@/lib/model-grades';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ model: string }> },
) {
  const { model } = await params;
  await req.json();

  const grades = gradeLegsForModel(model);

  return NextResponse.json({ model, grades });
}
