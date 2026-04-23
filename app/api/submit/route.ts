import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { submitTyped, submitFinalTyped } from '@/lib/state';

export const runtime = 'nodejs';

// Public endpoint: any client can submit typed text for the current race.
// Payload:
//   { raceId: string, lane?: 'p1'|'p2', typed: string, elapsedMs: number, finalId?: number }
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    if (body.finalId) {
      const r = await submitFinalTyped({
        finalId: Number(body.finalId),
        typed: String(body.typed || ''),
        elapsedMs: Number(body.elapsedMs || 0),
      });
      return NextResponse.json(r);
    }
    const r = await submitTyped({
      raceId: String(body.raceId || ''),
      lane: body.lane,
      typed: String(body.typed || ''),
      elapsedMs: Number(body.elapsedMs || 0),
    });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
