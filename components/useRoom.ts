'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

// sessionStorage key used to hand off a freshly-joined room from
// /head-to-head -> /h2h/[id]/[lane] so the player page hydrates instantly
// without waiting for the next fetch/realtime tick.
export const ROOM_HYDRATE_KEY = 'h2h:hydrate';

export type Room = {
  id: string;
  passage_id: string;
  duration_s: number;
  status: 'waiting' | 'ready' | 'running' | 'done';
  p1_name: string | null;
  p2_name: string | null;
  p1_joined_at: string | null;
  p2_joined_at: string | null;
  countdown_started_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
  p1_typed: string | null;
  p2_typed: string | null;
  p1_elapsed_ms: number | null;
  p2_elapsed_ms: number | null;
  p1_submitted_at: string | null;
  p2_submitted_at: string | null;
  p1_score: number | null;
  p2_score: number | null;
  p1_wpm: number | null;
  p2_wpm: number | null;
  p1_acc: number | null;
  p2_acc: number | null;
  winner: '1' | '2' | 'tie' | null;
};

// Subscribes a single h2h room. Refetches /api/h2h/[id] on any DB change for
// that room. Also polls every 5s as a safety net.
export function useRoom(id: string): {
  room: Room | null;
  passageText: string;
  refresh: () => void;
  error: string | null;
} {
  // Hydrate from sessionStorage handoff so the very first paint already
  // reflects the latest known room state (e.g. right after a join API call).
  const initial = readHydrate(id);
  const [room, setRoom] = useState<Room | null>(initial?.room ?? null);
  const [passageText, setPassageText] = useState(initial?.passageText ?? '');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<any>(null);

  const fetchNow = useCallback(async () => {
    try {
      const r = await fetch(`/api/h2h/${id}`, { cache: 'no-store' });
      if (!r.ok) {
        setError((await r.json()).error || 'not_found');
        return;
      }
      const j = await r.json();
      setRoom(j.room);
      setPassageText(j.passageText || '');
      setError(null);
    } catch {}
  }, [id]);

  const debounced = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      fetchNow();
    }, 100);
  }, [fetchNow]);

  // Adaptive poll cadence. Realtime is best-effort (and may be disabled at
  // the project level); polling is the fallback that guarantees the lobby
  // and live race feel responsive.
  const status = room?.status;
  const pollMs = status === 'waiting' || status === 'ready'
    ? 1000           // lobby: must feel instant when opponent joins / start fires
    : status === 'running'
      ? 2000         // race: spectator/peer view; in-band submits drive the typing UI
      : 10000;       // done / unknown

  useEffect(() => {
    fetchNow();
    let sb: ReturnType<typeof supabaseBrowser> | null = null;
    try { sb = supabaseBrowser(); } catch {}
    let channel: any = null;
    if (sb) {
      channel = sb
        .channel(`h2h-${id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'h2h_rooms', filter: `id=eq.${id}` },
          debounced
        )
        .subscribe();
    }
    const iv = setInterval(fetchNow, pollMs);
    // Also refetch the moment the user returns to this tab — important for
    // multi-window testing where one window was backgrounded while the
    // other player joined.
    const onVis = () => { if (document.visibilityState === 'visible') fetchNow(); };
    const onFocus = () => fetchNow();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      if (channel && sb) sb.removeChannel(channel);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [id, fetchNow, debounced, pollMs]);

  return { room, passageText, refresh: fetchNow, error };
}

function readHydrate(id: string): { room: Room; passageText: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ROOM_HYDRATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // One-shot: clear after read so we don't pin stale state on revisits.
    window.sessionStorage.removeItem(ROOM_HYDRATE_KEY);
    if (parsed?.room?.id === id) return parsed;
    return null;
  } catch {
    return null;
  }
}
