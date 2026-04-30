import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { startEventRun } from '@/lib/state';
import { friendlyError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// Day-end Final Event "play solo event" entry point. Phone-identifies the
// finalist via lib/state's findOrCreatePlayerByPhone, creates a solo_runs row
// flagged is_event_run=true with the day's deterministic 8-passage sequence,
// and returns { runId, passages, ... } so the client can render the typing
// flow. Submission/finalize reuse /api/play/submit + /api/play/finalize.
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const result = await startEventRun({
      phone: String(body?.phone || ''),
    });
    return NextResponse.json(result, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: friendlyError(e) }, { status: 400 });
  }
}
