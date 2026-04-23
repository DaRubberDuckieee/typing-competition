import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { createRoom } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const room = await createRoom({
      passageId: body.passageId,
      durationS: body.durationS,
    });
    return NextResponse.json({ room });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
