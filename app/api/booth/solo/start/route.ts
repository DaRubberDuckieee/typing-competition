import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { startBoothSoloRun } from '@/lib/state';
import { friendlyError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// Booth solo start: create a phone-identified solo_runs row using the same
// identity and leaderboard semantics as the two-lane booth flow.
//
// Body: { name: string, company: string, phone: string }
// Response: { run, player, passages, returning, previousBestWpm, previousBestScore }
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const result = await startBoothSoloRun({
      phone: String(body?.phone || ''),
      name: String(body?.name || ''),
      company: body?.company ? String(body.company) : undefined,
    });
    return NextResponse.json(result, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: friendlyError(e) }, { status: 400 });
  }
}
