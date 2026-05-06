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
  const requestedLimit = Number(url.searchParams.get('limit') || 20);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(1000, Math.floor(requestedLimit)))
    : 20;
  const rows = await leaderboard(limit, scope);
  return NextResponse.json(
    { rows, scope, limit },
    {
      headers: {
        'cache-control': 'no-store, no-cache, must-revalidate',
        pragma: 'no-cache',
        expires: '0',
      },
    },
  );
}
