import { NextRequest, NextResponse } from 'next/server';
import { leaderboard } from '@/lib/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// Standalone leaderboard endpoint for the landing/leaderboard view. Supports
// scope=today (default, scoped to current event_day) and scope=all (every
// event_day folded together for the cross-conference cumulative view).
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'today';
  const rows = await leaderboard(20, scope);
  return NextResponse.json(
    { rows, scope },
    {
      headers: {
        'cache-control': 'no-store, no-cache, must-revalidate',
        pragma: 'no-cache',
        expires: '0',
      },
    },
  );
}
