import { NextRequest, NextResponse } from 'next/server';
import { boothCurrent } from '@/lib/state';
import { friendlyError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// Snapshot of the current booth race for both lanes. The booth lane page
// polls this; cache must be off (we got bitten by Next.js fetch caching once
// already on /api/h2h/[id]).
export async function GET(req: NextRequest) {
  try {
    const raceId = req.nextUrl.searchParams.get('raceId') || undefined;
    const data = await boothCurrent(raceId);
    return NextResponse.json(data, {
      headers: {
        'cache-control': 'no-store, no-cache, must-revalidate',
        pragma: 'no-cache',
        expires: '0',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
  }
}
