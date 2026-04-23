import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { finalizeRace } from '@/lib/state';

export const runtime = 'nodejs';

// Called by a client that has observed local time >= ends_at. Idempotent.
export async function POST(req: NextRequest) {
  try {
    const { raceId } = await readBody(req);
    if (!raceId) return NextResponse.json({ error: 'raceId required' }, { status: 400 });
    const r = await finalizeRace(String(raceId));
    return NextResponse.json({ ok: true, race: r });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
