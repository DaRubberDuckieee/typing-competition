import { NextRequest, NextResponse } from 'next/server';
import { startRoom } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const room = await startRoom(params.id);
    return NextResponse.json({ room });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
