import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { joinRoom } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { lane, name } = await readBody(req);
    if (lane !== '1' && lane !== '2') {
      return NextResponse.json({ error: 'lane must be "1" or "2"' }, { status: 400 });
    }
    const room = await joinRoom({ id: params.id, lane, name: String(name || '') });
    return NextResponse.json({ room });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
