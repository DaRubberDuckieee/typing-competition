// Admin auth. If ADMIN_TOKEN is unset, admin endpoints are open (dev mode).
// In prod, staff paste the token into the Admin page once; it's stored in
// localStorage and sent as X-Admin-Token on every admin request.
import { NextRequest, NextResponse } from 'next/server';

export function requireAdmin(req: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return null; // open for local dev
  const provided = req.headers.get('x-admin-token') || new URL(req.url).searchParams.get('token');
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export async function readBody(req: NextRequest): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
