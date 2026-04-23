import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, readBody } from '@/lib/auth';
import { startRace } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  try {
    const body = await readBody(req);
    const race = await startRace({
      p1: body.p1 || {},
      p2: body.p2 || {},
      durationS: body.durationS,
      passageId: body.passageId,
    });
    return NextResponse.json({ race });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
