import { NextRequest, NextResponse } from 'next/server';
import { finalizeRoom } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const room = await finalizeRoom(params.id);
  return NextResponse.json({ room });
}
