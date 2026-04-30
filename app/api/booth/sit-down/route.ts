import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { boothSitDown } from '@/lib/state';
import { friendlyError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// Booth sit-down: attach a player to the open race for their lane (or create
// one if none exists). When both lanes are filled, the underlying state layer
// flips the race into 'pending' with countdown timestamps.
//
// Body: { lane: '1' | '2', name: string, title?: string, company?: string, phone: string }
// Response: { race, playerId, returning, previousBestWpm, previousBestScore }
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const lane = body?.lane;
    if (lane !== '1' && lane !== '2') {
      return NextResponse.json({ error: 'lane must be "1" or "2"' }, { status: 400 });
    }
    const result = await boothSitDown({
      lane,
      phone: String(body?.phone || ''),
      name: String(body?.name || ''),
      title: body?.title ? String(body.title) : undefined,
      company: body?.company ? String(body.company) : undefined,
    });
    return NextResponse.json(result, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e: any) {
    // Surface a human-readable error to the form. The raw message could be
    // anything from a thrown 'phone_invalid' code to a Supabase schema-cache
    // error; friendlyError() picks the right copy for each.
    return NextResponse.json({ error: friendlyError(e) }, { status: 400 });
  }
}
