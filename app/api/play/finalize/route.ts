import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { finalizeSoloRun } from '@/lib/state';

export const runtime = 'nodejs';

// Idempotent. Safe to call multiple times; finalizes a pending solo run.
export async function POST(req: NextRequest) {
  try {
    const { runId } = await readBody(req);
    if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });
    const run = await finalizeSoloRun(String(runId));
    return NextResponse.json({ run });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
