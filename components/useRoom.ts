'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

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
  const [room, setRoom] = useState<Room | null>(null);
  const [passageText, setPassageText] = useState('');
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
    const iv = setInterval(fetchNow, 5000);
    return () => {
      if (channel && sb) sb.removeChannel(channel);
      clearInterval(iv);
    };
  }, [id, fetchNow, debounced]);

  return { room, passageText, refresh: fetchNow, error };
}
