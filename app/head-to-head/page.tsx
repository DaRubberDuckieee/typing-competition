'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/components/api';

type View = 'idle' | 'joining';

export default function HeadToHeadPage() {
  const router = useRouter();
  const [view, setView] = useState<View>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Create a room on the server, then route the creator straight to the
  // player page for lane 1. Name is collected there — not here — so it's
  // only ever asked once (was a duplicate-prompt bug previously).
  async function createRoom() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ room: { id: string } }>('/api/h2h/create', {
        method: 'POST',
        body: JSON.stringify({ durationS: 60 }),
      });
      router.push(`/h2h/${r.room.id}/1`);
    } catch (e: any) {
      setErr(e.message || 'could not create room');
      setBusy(false);
    }
  }

  // Just routes to the player page for lane 2 — the JoinStep there handles
  // name entry and the actual /api/h2h/<id>/join call. We do a quick GET to
  // validate the code so the user gets immediate feedback if it's wrong
  // (instead of bouncing them to a "Room not found" screen).
  async function joinWithCode() {
    if (!code.trim()) return;
    const id = code.trim().toLowerCase();
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/h2h/${id}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('room not found — check the code and try again');
      router.push(`/h2h/${id}/2`);
    } catch (e: any) {
      setErr(e.message || 'could not join — check the code and try again');
      setBusy(false);
    }
  }

  if (view === 'joining') {
    return (
      <section style={{ maxWidth: 520, margin: '0 auto', paddingTop: 'clamp(48px, 10vh, 100px)' }}>
        <span className="eyebrow amber">Join a game</span>
        <h1 className="h1" style={{ marginTop: 14 }}>Enter the code</h1>
        <p className="h3" style={{ marginTop: 14, maxWidth: 460 }}>
          Paste the room code your opponent shared with you. You'll enter your name on the next screen.
        </p>

        <div className="card" style={{ marginTop: 32 }}>
          <label>Room code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. ABC12345"
            autoFocus
            style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}
            onKeyDown={(e) => { if (e.key === 'Enter') joinWithCode(); }}
          />
          <div style={{ height: 16 }} />
          <div className="row-wrap">
            <button
              className="btn big"
              disabled={!code.trim() || busy}
              onClick={joinWithCode}
            >
              {busy ? 'Joining…' : 'Continue →'}
            </button>
            <button className="btn ghost" onClick={() => { setView('idle'); setErr(null); }}>
              Back
            </button>
          </div>
          {err && <div style={{ marginTop: 12 }}><span className="pill err">{err}</span></div>}
        </div>
      </section>
    );
  }

  return (
    <section>
      <span className="eyebrow amber">Head-to-Head</span>
      <h1 className="h1" style={{ marginTop: 14 }}>Race a friend</h1>
      <p className="h3" style={{ marginTop: 16, maxWidth: 580 }}>
        Create a room and share the code, or jump into an existing room with a code from your opponent.
        60 seconds, live scoring, winner revealed.
      </p>

      <div className="grid2" style={{ marginTop: 40 }}>
        <div className="card schema">
          <span className="eyebrow amber">New game</span>
          <h2 className="h2" style={{ marginTop: 10 }}>Create a room</h2>
          <p className="h3" style={{ marginTop: 10 }}>
            Start a new game and get a shareable code for your opponent.
          </p>
          <div style={{ marginTop: 22 }}>
            <button className="btn big" disabled={busy} onClick={createRoom}>
              {busy ? 'Creating…' : 'Create room'}
            </button>
          </div>
          <p className="h3" style={{ marginTop: 12, color: 'var(--muted)' }}>
            You'll enter your name on the next screen.
          </p>
        </div>

        <div className="card schema">
          <span className="eyebrow">Join game</span>
          <h2 className="h2" style={{ marginTop: 10 }}>Join a room</h2>
          <p className="h3" style={{ marginTop: 10 }}>
            Have a code? Enter it to join your opponent's room as Player 2.
          </p>
          <div style={{ marginTop: 22 }}>
            <button className="btn big ghost" onClick={() => { setView('joining'); setErr(null); }}>
              Join with code
            </button>
          </div>
        </div>
      </div>

      {err && <div style={{ marginTop: 16 }}><span className="pill err">{err}</span></div>}
    </section>
  );
}
