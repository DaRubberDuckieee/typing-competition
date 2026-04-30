import { NextRequest, NextResponse } from 'next/server';
import { eventLeaderboard, eventDays } from '@/lib/state';
import { friendlyError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// Per-day Final Event leaderboard. Query params:
//   ?day=YYYY-MM-DD  (optional; defaults to today's UTC date)
// Response: { day, rows: EventLBEntry[], days: string[] }
//   `rows` is the leaderboard for the requested day (best run per player).
//   `days` is the full list of days that have at least one finished event
//   run, so the client can render historical day tabs.
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const day = url.searchParams.get('day') || undefined;
    const [rows, days] = await Promise.all([eventLeaderboard(day), eventDays()]);
    return NextResponse.json(
      { day: day || null, rows, days },
      {
        headers: {
          'cache-control': 'no-store, no-cache, must-revalidate',
          pragma: 'no-cache',
          expires: '0',
        },
      },
    );
  } catch (e: any) {
    return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
  }
}
