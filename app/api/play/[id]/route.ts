import { NextRequest, NextResponse } from 'next/server';
import { getSoloRun } from '@/lib/state';
import { getPassage } from '@/lib/passages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = await getSoloRun(params.id);
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const passage = getPassage(run.passage_id);
  return NextResponse.json({ run, passageText: passage.text }, { headers: { 'cache-control': 'no-store' } });
}
