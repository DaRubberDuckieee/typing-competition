import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { roomSubmit } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { lane, typed, elapsedMs } = await readBody(req);
    if (lane !== '1' && lane !== '2') {
      return NextResponse.json({ error: 'lane must be "1" or "2"' }, { status: 400 });
    }
    const r = await roomSubmit({
      id: params.id,
      lane,
      typed: String(typed || ''),
      elapsedMs: Number(elapsedMs || 0),
    });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
