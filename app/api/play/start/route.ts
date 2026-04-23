import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { startSoloRun } from '@/lib/state';
import { PASSAGES } from '@/lib/passages';

export const runtime = 'nodejs';

// Public endpoint: start a solo timed run.
// Body: { name?, title?, company?, durationS?, passageId? }
// Response: { run, player, passages: [{id, text}] } — client needs all passage
// texts so it can cycle when the player completes one mid-run.
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const r = await startSoloRun({
      player: { name: body.name, title: body.title, company: body.company },
      durationS: body.durationS,
      passageId: body.passageId,
    });
    return NextResponse.json({
      ...r,
      passages: PASSAGES.map((p) => ({ id: p.id, text: p.text })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
