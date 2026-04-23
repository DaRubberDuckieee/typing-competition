import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, readBody } from '@/lib/auth';
import { lockFinal } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  try {
    const { playerIds } = await readBody(req);
    const final = await lockFinal({ isCeo: true, ceoPlayerIds: playerIds });
    return NextResponse.json({ final });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
