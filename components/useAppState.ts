'use client';
// Client hook that subscribes to the app's state.
//
// Strategy:
//   - On mount, fetch /api/state for a full snapshot.
//   - Subscribe to Supabase Realtime change feeds on the critical tables.
//     On any change, debounced-refetch /api/state (cheaper than trying to
//     patch state client-side and risking drift).
//   - Also poll /api/state every 10s as a safety net in case Realtime drops.

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import type { AppState } from '@/lib/types';

export function useAppState(): { state: AppState | null; refresh: () => void; connected: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const [connected, setConnected] = useState(false);
  const lastFetchRef = useRef(0);
  const pendingRef = useRef<any>(null);

  const fetchNow = useCallback(async () => {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setState(j);
        setConnected(true);
        lastFetchRef.current = Date.now();
      }
    } catch {
      setConnected(false);
    }
  }, []);

  const debouncedRefetch = useCallback(() => {
    if (pendingRef.current) clearTimeout(pendingRef.current);
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      fetchNow();
    }, 120);
  }, [fetchNow]);

  useEffect(() => {
    fetchNow();
    let sb: ReturnType<typeof supabaseBrowser> | null = null;
    try {
      sb = supabaseBrowser();
    } catch {
      // Env vars missing in dev; fall back to polling only.
    }

    let channel: any = null;
    if (sb) {
      channel = sb
        .channel('typing-race')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'races' }, debouncedRefetch)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'final' }, debouncedRefetch)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'final_runs' }, debouncedRefetch)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, debouncedRefetch)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, debouncedRefetch)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'event' }, debouncedRefetch)
        .subscribe();
    }

    // Safety net: poll every 10s.
    const iv = setInterval(() => {
      if (Date.now() - lastFetchRef.current > 9000) fetchNow();
    }, 5000);

    return () => {
      if (channel && sb) sb.removeChannel(channel);
      clearInterval(iv);
    };
  }, [fetchNow, debouncedRefetch]);

  return { state, refresh: fetchNow, connected };
}
