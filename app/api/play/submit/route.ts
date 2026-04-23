import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { submitSoloTyped } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { runId, typed, elapsedMs, segments } = await readBody(req);
    if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });
    const r = await submitSoloTyped({
      runId: String(runId),
      typed: typed != null ? String(typed) : undefined,
      elapsedMs: elapsedMs != null ? Number(elapsedMs) : undefined,
      segments: Array.isArray(segments) ? segments : undefined,
    });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
