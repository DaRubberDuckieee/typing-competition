import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, readBody } from '@/lib/auth';
import { resetEventDay } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const { day } = await readBody(req);
  const event_day = await resetEventDay(day);
  return NextResponse.json({ ok: true, event_day });
}
