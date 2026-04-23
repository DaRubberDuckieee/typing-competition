import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, readBody } from '@/lib/auth';
import { abortRace, appState } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  try {
    const body = await readBody(req);
    let raceId = body.raceId as string | undefined;
    if (!raceId) {
      // Fall back to "whatever is live right now"
      const s = await appState();
      if (s.live?.kind === 'race') raceId = (s.live as any).id;
    }
    if (raceId) await abortRace(raceId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
