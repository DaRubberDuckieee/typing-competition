import { NextRequest, NextResponse } from 'next/server';
import { readBody } from '@/lib/auth';
import { renamePlayer } from '@/lib/state';

export const runtime = 'nodejs';

// Public endpoint — a player renames themselves after a solo run. Collisions
// are resolved server-side by appending " #2", " #3" and so on.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { name } = await readBody(req);
    const player = await renamePlayer(params.id, String(name || ''));
    return NextResponse.json({ player });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
