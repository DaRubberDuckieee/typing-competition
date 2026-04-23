'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/components/api';
import { useAppState } from '@/components/useAppState';

// The lane component derives its "phase" from DB timestamps, not server memory.
//   phase = countdown   when now < starts_at
//   phase = running     when starts_at <= now < ends_at AND status != done
//   phase = done        when status == done
//   phase = aborted     when status == aborted

type Lane = 'p1' | 'p2';

export default function LanePage() {
  const params = useParams<{ id: string }>();
  const lane: Lane = params?.id === '2' ? 'p2' : 'p1';
  const { state } = useAppState();
  const live = state?.live as any;

  const [typed, setTyped] = useState('');
  const submittedRef = useRef(false);
  const keyRef = useRef<string>(''); // current race/run key to detect changes

  // Determine current race/run key and reset typing when it changes.
  const currentKey = live
    ? live.kind === 'race'
      ? live.id
      : live.kind === 'final'
        ? `final:${live.id}:${live.current_index}`
        : ''
    : '';
  useEffect(() => {
    if (currentKey !== keyRef.current) {
      keyRef.current = currentKey;
      setTyped('');
      submittedRef.current = false;
    }
  }, [currentKey]);

  // Compute phase.
  const phase = useMemo(() => computePhase(live, lane), [live, lane]);

  // Keystrokes active only in running phase & for the correct lane.
  useEffect(() => {
    if (!live || phase !== 'running') return;
    // In a final, only lane 1 accepts input (solo).
    if (live.kind === 'final' && lane !== 'p1') return;
    const passage: string = live.passageText || '';
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Backspace') { e.preventDefault(); setTyped((t) => t.slice(0, -1)); return; }
      if (e.key === 'Tab')       { e.preventDefault(); setTyped((t) => t + '  '); return; }
      if (e.key === 'Enter')     { e.preventDefault(); setTyped((t) => t + '\n'); return; }
      if (e.key.length === 1) {
        e.preventDefault();
        setTyped((t) => (t.length >= passage.length + 5 ? t : t + e.key));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, phase, lane]);

  // Auto-submit when user finishes the passage.
  useEffect(() => {
    if (!live || phase !== 'running' || submittedRef.current) return;
    if (typed === (live.passageText || '')) {
      submitNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, live, phase]);

  // Auto-submit near the deadline + trigger server-side finalize.
  useEffect(() => {
    if (!live || phase !== 'running') return;
    const iv = setInterval(() => {
      const endsAt = live.kind === 'race' ? live.ends_at : live.current_ends_at;
      if (!endsAt) return;
      const remaining = new Date(endsAt).getTime() - Date.now();
      if (remaining <= 300 && !submittedRef.current) {
        submitNow();
      }
      // Any client observing that the deadline has passed nudges the server
      // to finalize. Safe because finalize is idempotent.
      if (remaining <= -500) {
        finalizeNow();
      }
    }, 200);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, phase]);

  async function submitNow() {
    if (!live) return;
    submittedRef.current = true;
    const startsAt = live.kind === 'race' ? live.starts_at : live.current_starts_at;
    const elapsedMs = startsAt ? Date.now() - new Date(startsAt).getTime() : 0;
    try {
      if (live.kind === 'race') {
        await api('/api/submit', {
          method: 'POST',
          body: JSON.stringify({ raceId: live.id, lane, typed, elapsedMs }),
        });
      } else if (live.kind === 'final') {
        await api('/api/submit', {
          method: 'POST',
          body: JSON.stringify({ finalId: live.id, typed, elapsedMs }),
        });
      }
    } catch {
      submittedRef.current = false; // allow retry
    }
  }
  async function finalizeNow() {
    if (!live) return;
    try {
      if (live.kind === 'race') {
        await api('/api/race/finalize', {
          method: 'POST',
          body: JSON.stringify({ raceId: live.id }),
        });
      } else if (live.kind === 'final') {
        await api('/api/final/finalize', {
          method: 'POST',
          body: JSON.stringify({ finalId: live.id }),
        });
      }
    } catch {}
  }

  if (!state) return <div className="h2">Connecting…</div>;

  if (!live) {
    return (
      <div className="full-stage center">
        <div className="h1">Waiting for next race…</div>
        <div className="h3">Staff will call you up when it's your turn.</div>
      </div>
    );
  }

  if (live.kind === 'final' && lane === 'p2') {
    return (
      <div className="full-stage center">
        <div className="h1">Final round — solo run</div>
        <div className="h3">This lane is a spectator.</div>
      </div>
    );
  }

  return (
    <div className="full-stage">
      {phase === 'countdown' && <Countdown live={live} />}
      {phase === 'running' && (
        <RunningLane lane={lane} live={live} typed={typed} />
      )}
      {phase === 'done' && <DoneLane live={live} lane={lane} />}
      {phase === 'aborted' && (
        <div className="full-stage center">
          <div className="h1" style={{ color: 'var(--err)' }}>Race aborted</div>
          <div className="h3">Please wait for staff to restart.</div>
        </div>
      )}
    </div>
  );
}

function computePhase(live: any, lane: Lane): 'idle' | 'countdown' | 'running' | 'done' | 'aborted' {
  if (!live) return 'idle';
  if (live.kind === 'race') {
    if (live.status === 'aborted') return 'aborted';
    if (live.status === 'done') return 'done';
    const now = Date.now();
    if (live.starts_at && now < new Date(live.starts_at).getTime()) return 'countdown';
    return 'running';
  }
  if (live.kind === 'final') {
    if (live.current_status !== 'pending') return live.current_status === 'done' ? 'done' : 'idle';
    const now = Date.now();
    if (live.current_starts_at && now < new Date(live.current_starts_at).getTime()) return 'countdown';
    return 'running';
  }
  return 'idle';
}

function Countdown({ live }: { live: any }) {
  const startsAt = live.kind === 'race' ? live.starts_at : live.current_starts_at;
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(startsAt).getTime() - Date.now()));
  useEffect(() => {
    const iv = setInterval(() => {
      setRemaining(Math.max(0, new Date(startsAt).getTime() - Date.now()));
    }, 50);
    return () => clearInterval(iv);
  }, [startsAt]);
  const n = Math.ceil(remaining / 1000);
  return (
    <div className="full-stage center">
      <div className="h2">Get ready…</div>
      <div className="countdown">{n > 0 ? n : 'GO!'}</div>
      <div className="h3">Passage: {live.passage_id}</div>
    </div>
  );
}

function RunningLane({ lane, live, typed }: { lane: Lane; live: any; typed: string }) {
  const endsAt = live.kind === 'race' ? live.ends_at : live.current_ends_at;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(iv);
  }, []);
  const remainingS = Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 1000));
  const timerClass = remainingS <= 5 ? 'timer err' : remainingS <= 15 ? 'timer warn' : 'timer';
  const name = live.kind === 'race' ? (lane === 'p1' ? live.p1Name : live.p2Name) : live.playerName;

  return (
    <>
      <div className="row">
        <div className="h2" style={{ color: lane === 'p1' ? 'var(--p1)' : 'var(--p2)' }}>
          {lane === 'p1' ? 'Player 1' : 'Player 2'} — {name}
        </div>
        <div className="spacer" />
        <div className={timerClass}>{remainingS}s</div>
      </div>
      <RenderedPassage passage={live.passageText} typed={typed} />
      <div className="h3" style={{ marginTop: 10 }}>Just type — Backspace works, no click needed.</div>
    </>
  );
}

function RenderedPassage({ passage, typed }: { passage: string; typed: string }) {
  const chars = useMemo(() => {
    const out: Array<{ ch: string; cls: string }> = [];
    for (let i = 0; i < passage.length; i++) {
      if (i < typed.length) {
        out.push({ ch: passage[i], cls: typed[i] === passage[i] ? 'correct' : 'wrong' });
      } else if (i === typed.length) {
        out.push({ ch: passage[i], cls: 'pending cursor' });
      } else {
        out.push({ ch: passage[i], cls: 'pending' });
      }
    }
    return out;
  }, [passage, typed]);
  return (
    <div className="passage">
      {chars.map((c, i) => (
        <span key={i} className={'ch ' + c.cls}>{c.ch === '\n' ? '\n' : c.ch}</span>
      ))}
    </div>
  );
}

function DoneLane({ live, lane }: { live: any; lane: Lane }) {
  let wpm = '—', acc = '—', score = '—', errors: any = null;
  if (live.kind === 'race') {
    wpm = String(lane === 'p1' ? live.p1_wpm : live.p2_wpm);
    acc = String(lane === 'p1' ? live.p1_acc : live.p2_acc);
    score = String(lane === 'p1' ? live.p1_score : live.p2_score);
    errors = lane === 'p1' ? live.p1_errors : live.p2_errors;
  }
  return (
    <div className="full-stage center">
      <div className="h1">Race complete</div>
      <div className="grid2" style={{ marginTop: 20 }}>
        <div className="tile"><div className="lbl">WPM</div><div className="big">{wpm}</div></div>
        <div className="tile"><div className="lbl">Accuracy</div><div className="big">{acc}%</div></div>
        <div className="tile"><div className="lbl">Score</div><div className="big">{score}</div></div>
        <div className="tile">
          <div className="lbl">Errors</div>
          <div className="big" style={{ fontSize: 22 }}>
            {errors ? Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join(' · ') : '—'}
          </div>
        </div>
      </div>
      <div className="h3" style={{ marginTop: 24 }}>See the leaderboard screen for your ranking.</div>
      <div style={{ marginTop: 16 }}>
        <Link className="btn ghost" href="/leaderboard">Open leaderboard</Link>
      </div>
    </div>
  );
}
