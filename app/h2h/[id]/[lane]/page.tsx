'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/components/api';
import { useRoom } from '@/components/useRoom';

// Per-player view. Enters name, waits for opponent + start, types for 60s,
// sees green-flash / red-flash results depending on win/lose.

export default function PlayerPage() {
  const { id, lane } = useParams<{ id: string; lane: string }>();
  const laneNum = lane === '1' ? '1' : lane === '2' ? '2' : null;
  const { room, passageText, error, refresh } = useRoom(id);
  const [joinedLocally, setJoinedLocally] = useState(false);

  if (!laneNum) return <div className="h2" style={{ padding: 40 }}>Invalid lane.</div>;
  if (error)   return <div className="h2" style={{ padding: 40 }}>Room not found.</div>;
  if (!room)   return <div className="h2" style={{ padding: 40 }}>Loading room…</div>;

  const myName = laneNum === '1' ? room.p1_name : room.p2_name;
  const myJoined = !!myName || joinedLocally;

  if (!myJoined) return <JoinStep roomId={id} lane={laneNum} otherName={laneNum === '1' ? room.p2_name : room.p1_name} onJoined={() => { setJoinedLocally(true); refresh(); }} />;

  if (room.status === 'waiting' || room.status === 'ready') {
    return <WaitingStep room={room} laneNum={laneNum} />;
  }

  if (room.status === 'running') {
    return <TypingStep room={room} laneNum={laneNum} passage={passageText} />;
  }

  // status === 'done'
  return <ResultStep room={room} laneNum={laneNum} />;
}

/* ------------------------------ Join step ------------------------------ */

function JoinStep({
  roomId, lane, otherName, onJoined,
}: { roomId: string; lane: '1' | '2'; otherName: string | null; onJoined: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function join() {
    setSaving(true); setErr(null);
    try {
      await api(`/api/h2h/${roomId}/join`, {
        method: 'POST',
        body: JSON.stringify({ lane, name }),
      });
      onJoined();
    } catch (e: any) {
      setErr(e.message || 'could not join');
      setSaving(false);
    }
  }

  const accent = lane === '1' ? 'var(--cyan)' : 'var(--amber)';
  return (
    <div className="full-stage" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 'clamp(48px, 10vh, 120px)' }}>
      <span className="eyebrow" style={{ color: accent }}>Player {lane}</span>
      <h1 className="h1" style={{ marginTop: 14 }}>You're up.</h1>
      <p className="h3" style={{ marginTop: 16, maxWidth: 560 }}>
        Enter your name to join this 1v1.
        {otherName && <> Your opponent is <b style={{ color: 'var(--fg)' }}>{otherName}</b>.</>}
      </p>

      <div className="card" style={{ width: '100%', maxWidth: 480, marginTop: 48, textAlign: 'left' }}>
        <label>Your name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jess"
          autoFocus
        />
        <div style={{ height: 18 }} />
        <button className="btn big" disabled={!name.trim() || saving} onClick={join}>
          {saving ? 'Joining…' : 'Join race'}
        </button>
        {err && <div style={{ marginTop: 14 }}><span className="pill err">{err}</span></div>}
      </div>
    </div>
  );
}

/* ----------------------------- Waiting step ----------------------------- */

function WaitingStep({ room, laneNum }: { room: any; laneNum: '1' | '2' }) {
  const otherName = laneNum === '1' ? room.p2_name : room.p1_name;
  const myName = laneNum === '1' ? room.p1_name : room.p2_name;
  const accent = laneNum === '1' ? 'var(--cyan)' : 'var(--amber)';
  // Gate on both names being present, not status. The server normally flips
  // status to 'ready' on the second join, but a concurrent-join race or a
  // missed Realtime tick can leave it at 'waiting'. Either way, if both
  // lanes are named, we're good to start.
  const bothReady = !!(room.p1_name && room.p2_name);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);

  async function startGame() {
    if (starting) return;
    setStarting(true); setStartErr(null);
    try {
      await api(`/api/h2h/${room.id}/start`, { method: 'POST', body: '{}' });
      // Polling / realtime in useRoom will pick up status='running' and the
      // PlayerPage will swap to <TypingStep>. We intentionally don't reset
      // `starting` so the button stays disabled until the transition.
    } catch (e: any) {
      setStartErr(e?.message || 'could not start the game');
      setStarting(false);
    }
  }

  return (
    <div className="full-stage" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 'clamp(48px, 10vh, 120px)' }}>
      <span className="eyebrow" style={{ color: accent }}>Player {laneNum} · {myName}</span>
      <h1 className="h1" style={{ marginTop: 14 }}>
        {bothReady ? 'Ready to race!' : 'Waiting for opponent…'}
      </h1>

      <div className="card" style={{ marginTop: 32, maxWidth: 340, width: '100%', textAlign: 'center' }}>
        <span className="eyebrow">Room code</span>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(1.8rem, 5vw, 2.8rem)',
            fontWeight: 700,
            letterSpacing: '0.18em',
            marginTop: 8,
            color: 'var(--amber)',
          }}
        >
          {room.id.toUpperCase()}
        </div>
      </div>

      <div className="row-wrap" style={{ marginTop: 24, justifyContent: 'center' }}>
        <span className="pill ok">
          <span className="status-dot ok" /> You're in
        </span>
        <span className={'pill ' + (otherName ? 'ok' : '')}>
          <span className={'status-dot ' + (otherName ? 'ok' : '')} />
          {otherName ? `${otherName} joined` : 'Waiting for opponent'}
        </span>
      </div>

      {bothReady && (
        <div style={{ marginTop: 36 }}>
          <button className="btn huge" disabled={starting} onClick={startGame}>
            {starting ? 'Starting…' : 'Start game'}
          </button>
          <p className="h3" style={{ marginTop: 12, color: 'var(--muted)' }}>
            Either player can start.
          </p>
          {startErr && (
            <div style={{ marginTop: 12 }}>
              <span className="pill err">{startErr}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Typing step ------------------------------ */

function TypingStep({
  room, laneNum, passage,
}: { room: any; laneNum: '1' | '2'; passage: string }) {
  const accent = laneNum === '1' ? 'var(--cyan)' : 'var(--amber)';
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(iv);
  }, []);
  const startsAt = new Date(room.starts_at).getTime();
  const endsAt = new Date(room.ends_at).getTime();
  const inCountdown = now < startsAt;
  const countdownN = Math.ceil((startsAt - now) / 1000);
  const remainingS = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const timerClass = remainingS <= 5 ? 'timer err' : remainingS <= 15 ? 'timer warn' : 'timer';

  const [typed, setTyped] = useState('');
  const submittedRef = useRef(false);

  // Keystrokes only while running.
  useEffect(() => {
    if (inCountdown) return;
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
  }, [inCountdown, passage.length]);

  // Push typed text every 300ms so the spectator sees live progress.
  useEffect(() => {
    if (inCountdown) return;
    const iv = setInterval(() => {
      const elapsedMs = Math.max(0, Math.min(Date.now() - startsAt, room.duration_s * 1000));
      fetch(`/api/h2h/${room.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lane: laneNum, typed, elapsedMs }),
      }).catch(() => {});
    }, 300);
    return () => clearInterval(iv);
  }, [inCountdown, typed, startsAt, room.duration_s, room.id, laneNum]);

  // Final submit + nudge finalize as the deadline hits.
  useEffect(() => {
    if (inCountdown) return;
    const remaining = endsAt - now;
    if (remaining <= 250 && !submittedRef.current) {
      submittedRef.current = true;
      const elapsedMs = Math.min(Date.now() - startsAt, room.duration_s * 1000);
      fetch(`/api/h2h/${room.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lane: laneNum, typed, elapsedMs }),
      }).catch(() => {});
    }
    if (remaining <= -400) {
      fetch(`/api/h2h/${room.id}/finalize`, { method: 'POST' }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, inCountdown]);

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

  if (inCountdown) {
    return (
      <div className="full-stage center">
        <span className="eyebrow" style={{ color: accent }}>Player {laneNum}</span>
        <div className="h2" style={{ marginTop: 10 }}>Get ready…</div>
        <div className="countdown">{countdownN > 0 ? countdownN : 'GO!'}</div>
      </div>
    );
  }

  return (
    <div className="full-stage">
      <div className="row">
        <div className="h2" style={{ color: accent }}>Player {laneNum}</div>
        <div className="spacer" />
        <div className={timerClass}>{remainingS}s</div>
      </div>
      <div className="passage" style={{ marginTop: 14 }}>
        {chars.map((c, i) => (
          <span key={i} className={'ch ' + c.cls}>{c.ch === '\n' ? '\n' : c.ch}</span>
        ))}
      </div>
      <div className="h3" style={{ marginTop: 10 }}>
        Just type — Backspace works, no click needed.
      </div>
    </div>
  );
}

/* ----------------------------- Result step ----------------------------- */

function ResultStep({ room, laneNum }: { room: any; laneNum: '1' | '2' }) {
  const isWinner = room.winner === laneNum;
  const isTie = room.winner === 'tie';
  const my = laneNum === '1'
    ? { name: room.p1_name, score: room.p1_score, wpm: room.p1_wpm, acc: room.p1_acc }
    : { name: room.p2_name, score: room.p2_score, wpm: room.p2_wpm, acc: room.p2_acc };
  const accent = laneNum === '1' ? 'var(--cyan)' : 'var(--amber)';
  const flashClass = isTie ? 'flash-tie' : isWinner ? 'flash-winner' : 'flash-loser';

  return (
    <div className={'full-stage ' + flashClass} style={{ alignItems: 'center', textAlign: 'center' }}>
      <span className="eyebrow" style={{ color: accent }}>Player {laneNum} · {my.name}</span>
      <h1 className="h1" style={{ marginTop: 14, color: isWinner ? 'var(--ok)' : isTie ? 'var(--fg)' : 'var(--mars)' }}>
        {isTie ? 'Tie' : isWinner ? 'You won.' : 'You lost.'}
      </h1>

      <div className="grid2" style={{ width: '100%', maxWidth: 720, marginTop: 36 }}>
        <div className="tile"><div className="lbl">WPM</div><div className="big">{my.wpm ?? '—'}</div></div>
        <div className="tile"><div className="lbl">Accuracy</div><div className="big">{my.acc ?? '—'}%</div></div>
        <div className="tile" style={{ gridColumn: '1 / span 2' }}>
          <div className="lbl">Overall Score</div>
          <div className="big">{my.score ?? '—'}</div>
        </div>
      </div>

      <div className="row-wrap" style={{ marginTop: 32 }}>
        <Link className="btn" href="/play">Play solo</Link>
        <Link className="btn ghost" href="/head-to-head">Back to Head-to-Head</Link>
      </div>
    </div>
  );
}
