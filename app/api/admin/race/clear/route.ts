import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

// "Clear display" used to clear in-memory liveRace. Now that live is derived
// from DB state, clearing the display is just a UI concept: the clients stop
// showing "live" once the most recent race row is > 30s old (see appState).
// This endpoint exists only for UI parity; it's a no-op.
export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  return NextResponse.json({ ok: true });
}
