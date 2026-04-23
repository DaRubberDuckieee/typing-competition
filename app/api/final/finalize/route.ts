import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { finalizeFinalRun } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { finalId } = await readBody(req);
    if (!finalId) return NextResponse.json({ error: 'finalId required' }, { status: 400 });
    const r = await finalizeFinalRun(Number(finalId));
    return NextResponse.json({ ok: true, final: r });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
