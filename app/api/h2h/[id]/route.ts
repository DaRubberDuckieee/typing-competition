import { NextRequest, NextResponse } from 'next/server';
import { getRoom } from '@/lib/state';
import { getPassage } from '@/lib/passages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Belt-and-suspenders: Next.js 14 auto-caches fetch() under the hood, and the
// supabase-js client goes through fetch. `force-dynamic` should disable that
// cache for this route, but in practice we've seen stale rows served from a
// cached fetch built at startup. Setting revalidate=0 + fetchCache='force-no-store'
// guarantees every request hits Supabase.
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const room = await getRoom(params.id);
  if (!room) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const passage = getPassage(room.passage_id);
  return NextResponse.json(
    { room, passageText: passage.text },
    {
      headers: {
        'cache-control': 'no-store, no-cache, must-revalidate',
        'pragma': 'no-cache',
        'expires': '0',
      },
    }
  );
}
