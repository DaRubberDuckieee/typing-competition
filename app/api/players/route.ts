import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { upsertPlayer } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const player = await upsertPlayer(body);
    return NextResponse.json({ player });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
