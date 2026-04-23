import { NextResponse } from 'next/server';
import { appState } from '@/lib/state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const s = await appState();
    return NextResponse.json(s, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
