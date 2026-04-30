'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

// Player shape used by the booth UI (subset of the players table).
export type Player = {
  id: string;
  name: string | null;
  title: string | null;
  company: string | null;
  phone: string | null;
};

// Race shape used by the booth UI (subset of the races table).
export type Race = {
  id: string;
  event_day: string;
  passage_id: string;
  // Booth races pre-pick a list of passage IDs so both lanes type the same
  // sequence; legacy admin races leave this null.
  passage_ids: string[] | null;
  duration_s: number;
  status: 'waiting' | 'pending' | 'running' | 'done' | 'aborted';
  p1_id: string | null;
  p2_id: string | null;
  countdown_started_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
  p1_text: string | null;
  p2_text: string | null;
  p1_score: number | null;
  p2_score: number | null;
  p1_wpm: number | null;
  p2_wpm: number | null;
  p1_acc: number | null;
  p2_acc: number | null;
  winner_id: string | null;
};

export type RacePassage = { id: string; text: string };

export type BoothSnapshot = {
  race: Race | null;
  p1: Player | null;
  p2: Player | null;
  passages: RacePassage[];
};

// Polls /api/booth/current with adaptive cadence:
// - 1s while in lobby (waiting/pending) — must feel instant when opponent
//   joins or countdown fires
// - 2s while running — typing UI is keystroke-driven; this is just for
//   spectators/peer view
// - 10s otherwise (done, idle, etc.)
//
// Realtime is best-effort: a Supabase channel subscribed to the races table
// triggers a debounced refetch on any change. If realtime isn't reachable
// or the publication is misconfigured, polling keeps the UI fresh.
export function useBoothCurrent(): BoothSnapshot & {
  refresh: () => void;
  // Caller can hand in a freshly-fetched snapshot (e.g. the response from
  // POST /api/booth/sit-down) so the page renders the new state immediately
  // without waiting for the next poll tick.
  setSnapshot: (snap: BoothSnapshot) => void;
} {
  const [snap, setSnap] = useState<BoothSnapshot>({
    race: null,
    p1: null,
    p2: null,
    passages: [],
  });
  const pending = useRef<any>(null);
  // Monotonic counter bumped on every external setSnapshot. A fetch capture
  // its starting generation; if the generation has changed by the time the
  // fetch returns, we drop the result. This stops a fetch fired before the
  // user joined from clobbering the optimistic post-join snapshot — which
  // was the bug where the form re-mounted and reset itself.
  const generationRef = useRef(0);

  const fetchNow = useCallback(async () => {
    const startGen = generationRef.current;
    try {
      const r = await fetch('/api/booth/current', { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as BoothSnapshot;
      if (generationRef.current !== startGen) return;
      setSnap(j);
    } catch {}
  }, []);

  // External callers (e.g. the booth lane page after a successful sit-down)
  // hand in an authoritative snapshot we should render immediately; any
  // poll/fetch in flight at this moment becomes stale and gets dropped via
  // the generation guard above.
  const setSnapshot = useCallback((next: BoothSnapshot) => {
    generationRef.current += 1;
    setSnap(next);
  }, []);

  const debounced = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      fetchNow();
    }, 100);
  }, [fetchNow]);

  const status = snap.race?.status;
  const pollMs =
    status === 'waiting' || status === 'pending'
      ? 1000
      : status === 'running'
      ? 2000
      : 10000;

  useEffect(() => {
    fetchNow();
    let sb: ReturnType<typeof supabaseBrowser> | null = null;
    try {
      sb = supabaseBrowser();
    } catch {}
    let channel: any = null;
    if (sb) {
      channel = sb
        .channel('booth-races')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'races' },
          debounced,
        )
        .subscribe();
    }
    const iv = setInterval(fetchNow, pollMs);
    const onVis = () => {
      if (document.visibilityState === 'visible') fetchNow();
    };
    const onFocus = () => fetchNow();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      if (channel && sb) sb.removeChannel(channel);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchNow, debounced, pollMs]);

  return { ...snap, refresh: fetchNow, setSnapshot };
}
