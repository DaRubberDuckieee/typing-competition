import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { lockFinal } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  try {
    const final = await lockFinal();
    return NextResponse.json({ final });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
