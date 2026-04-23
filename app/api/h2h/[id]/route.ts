import { NextRequest, NextResponse } from 'next/server';
import { getRoom } from '@/lib/state';
import { getPassage } from '@/lib/passages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const room = await getRoom(params.id);
  if (!room) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const passage = getPassage(room.passage_id);
  return NextResponse.json(
    { room, passageText: passage.text },
    { headers: { 'cache-control': 'no-store' } }
  );
}
