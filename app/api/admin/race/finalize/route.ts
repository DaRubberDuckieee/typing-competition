import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, readBody } from '@/lib/auth';
import { finalizeRace } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const { raceId } = await readBody(req);
  if (!raceId) return NextResponse.json({ error: 'raceId required' }, { status: 400 });
  const race = await finalizeRace(String(raceId));
  return NextResponse.json({ race });
}
