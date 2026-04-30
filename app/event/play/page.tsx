'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { friendlyError } from '@/lib/errors';
import { formatPhoneInput } from '@/lib/phone';
import { LeaderboardView } from '@/components/LeaderboardView';
import { isEventOpenNow, EVENT_OPEN_HOUR_PT } from '@/lib/eventTime';

// Day-end Final Event "play solo event" page.
//   - Phone-identified InfoForm (same shape as booth, but solo).
//   - Multi-passage typing flow against the day's deterministic passage
//     sequence (every finalist on the same day types the same thing).
//   - Result flash with rank on today's event leaderboard, then a Continue
//     button that drops the player into a per-day event leaderboard view.
//
// Critically separate from booth flow: this page does not touch
// /api/booth/*, useBoothCurrent, or any of the booth state machine.

type EventPassage = { id: string; text: string };

type StartResponse = {
  run: { id: string; starts_at: string; ends_at: string; duration_s: number };
  player: { id: string; name: string };
  passages: EventPassage[];
};

type Phase =
  | { kind: 'form' }
  | { kind: 'racing'; start: StartResponse }
  | { kind: 'done'; start: StartResponse; finalRun: any };

export default function EventPlayPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  // Tick every 30s so the page auto-flips from "coming soon" to the form
  // when 5pm PT rolls over without requiring a reload.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);
  const eventOpen = useMemo(
    () => isEventOpenNow(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );

  if (phase.kind === 'form' && !eventOpen) {
    return <ComingSoon />;
  }

  if (phase.kind === 'form') {
    return (
      <InfoForm
        onStarted={(start) => setPhase({ kind: 'racing', start })}
      />
    );
  }
  if (phase.kind === 'racing') {
    return (
      <Racing
        start={phase.start}
        onDone={(finalRun) =>
          setPhase({ kind: 'done', start: phase.start, finalRun })
        }
      />
    );
  }
  return <DoneView playerId={phase.start.player.id} />;
}

/* ----------------------------- Coming soon ----------------------------- */

// Rendered when /event/play is hit before 5pm Pacific. Tells the player when
// the event opens and how to qualify, and gives them a clean way back to the
// landing page (where they can keep racing at the booth to climb the
// leaderboard).
function ComingSoon() {
  return (
    <div className="full-stage" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 'clamp(48px, 10vh, 120px)' }}>
      <span className="eyebrow amber">Final event · solo</span>
      <h1 className="h1" style={{ marginTop: 14 }}>Opens at {EVENT_OPEN_HOUR_PT - 12}pm Pacific.</h1>
      <p className="h3" style={{ marginTop: 18, maxWidth: 560 }}>
        The Final Event runs once per day at 5pm Pacific. To enter, you need to
        finish in the top 20 of today&rsquo;s leaderboard. Keep racing at the booth!
      </p>

      <div className="row-wrap" style={{ marginTop: 36, justifyContent: 'center' }}>
        <Link className="btn huge" href="/">Back to leaderboard</Link>
      </div>
    </div>
  );
}

/* ------------------------------ Info form ------------------------------ */

function InfoForm({ onStarted }: { onStarted: (s: StartResponse) => void }) {
  // Phone is the only input — we use it as the lookup key for the existing
  // player row (created at the booth earlier in the day) and to gate on
  // today's top-20 eligibility server-side.
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'idle' | 'submitting'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const phoneDigits = phone.replace(/\D+/g, '');
  const phoneOk = phoneDigits.length >= 10 && phoneDigits.length <= 15;

  async function submit() {
    if (!phoneOk || step !== 'idle') return;
    setStep('submitting');
    setErr(null);
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await fetch('/api/event/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
        cache: 'no-store',
        signal: ctrl.signal,
      });
      clearTimeout(timeoutId);
      const text = await r.text();
      const j = text ? JSON.parse(text) : {};
      if (!r.ok) throw new Error(j.error || r.statusText);
      onStarted(j as StartResponse);
    } catch (e: any) {
      clearTimeout(timeoutId);
      setErr(friendlyError(e));
      setStep('idle');
    }
  }

  return (
    <div className="full-stage" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 'clamp(48px, 10vh, 120px)' }}>
      <span className="eyebrow amber">Final event · solo</span>
      <h1 className="h1" style={{ marginTop: 14 }}>One shot.</h1>
      <p className="h3" style={{ marginTop: 14, maxWidth: 540 }}>
        60 seconds. Same passages as every other finalist today. Top 20 from today's leaderboard only — enter the phone you used at the booth.
      </p>

      <div className="card" style={{ width: '100%', maxWidth: 420, marginTop: 36, textAlign: 'left' }}>
        <label>Phone</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
          placeholder="555 123 4567 or +44 7700 900123"
          inputMode="tel"
          autoComplete="tel"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <p className="h3" style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
          Same number you used at the booth. We use it to look up your spot on today's leaderboard.
        </p>
        <div style={{ height: 18 }} />
        <button className="btn big" disabled={!phoneOk || step !== 'idle'} onClick={submit}>
          {step === 'submitting' ? 'Starting…' : 'Start the event'}
        </button>
        {err && <div style={{ marginTop: 14 }}><span className="pill err">{err}</span></div>}
      </div>

      <div style={{ marginTop: 24 }}>
        <Link className="btn ghost" href="/">Back</Link>
      </div>
    </div>
  );
}

/* ----------------------------- Racing step ----------------------------- */

type Segment = { passageId: string; typed: string; elapsedMs: number };

function Racing({
  start, onDone,
}: { start: StartResponse; onDone: (run: any) => void }) {
  const startsAt = useMemo(() => new Date(start.run.starts_at).getTime(), [start.run.starts_at]);
  const endsAt = useMemo(() => new Date(start.run.ends_at).getTime(), [start.run.ends_at]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(iv);
  }, []);
  const inCountdown = now < startsAt;
  const countdownN = Math.ceil((startsAt - now) / 1000);
  const remainingS = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const timerClass = remainingS <= 5 ? 'timer err' : remainingS <= 15 ? 'timer warn' : 'timer';

  const passages = start.passages;
  const safe = passages.length > 0 ? passages : [{ id: 'fallback', text: '' }];
  const [passageIdx, setPassageIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const segStartRef = useRef<number>(0);
  const finalSubmittedRef = useRef(false);
  const finalizedRef = useRef(false);

  const current = safe[passageIdx % safe.length];

  // Mark segment 1 start when countdown ends.
  useEffect(() => {
    if (!inCountdown && segStartRef.current === 0) {
      segStartRef.current = Math.max(Date.now(), startsAt);
    }
  }, [inCountdown, startsAt]);

  function snapshotSegments(): Segment[] {
    const elapsed = Math.max(0, Date.now() - (segStartRef.current || Date.now()));
    const inProgress: Segment = { passageId: current.id, typed, elapsedMs: elapsed };
    return typed.length > 0 || segments.length === 0
      ? [...segments, inProgress]
      : [...segments];
  }

  // Keystrokes (only after countdown). Cap at exact passage length so we
  // auto-advance the moment the cursor reaches the end.
  useEffect(() => {
    if (inCountdown) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Backspace') { e.preventDefault(); setTyped((t) => t.slice(0, -1)); return; }
      if (e.key === 'Tab')       { e.preventDefault(); setTyped((t) => t + '  '); return; }
      if (e.key === 'Enter')     { e.preventDefault(); setTyped((t) => t + '\n'); return; }
      if (e.key.length === 1) {
        e.preventDefault();
        setTyped((t) => (t.length >= current.text.length ? t : t + e.key));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inCountdown, current.text.length]);

  // Auto-advance on cursor past last char (matches booth behavior).
  useEffect(() => {
    if (inCountdown) return;
    if (typed.length < current.text.length) return;
    const segEnd = Date.now();
    const elapsedMs = Math.max(1, segEnd - (segStartRef.current || segEnd));
    setSegments((s) => [...s, { passageId: current.id, typed, elapsedMs }]);
    setTyped('');
    setPassageIdx((i) => (i + 1) % safe.length);
    segStartRef.current = segEnd;
  }, [typed, current, inCountdown, safe.length]);

  // Live progress every 1s (lighter than booth's 300ms — there's no peer
  // view to feed for solo, but the periodic write is insurance against a
  // browser crash mid-run).
  useEffect(() => {
    if (inCountdown) return;
    const iv = setInterval(() => {
      fetch('/api/play/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: start.run.id, segments: snapshotSegments() }),
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCountdown, typed, segments, passageIdx]);

  // Final submit + finalize at deadline.
  useEffect(() => {
    if (inCountdown) return;
    const remaining = endsAt - now;
    if (remaining <= 250 && !finalSubmittedRef.current) {
      finalSubmittedRef.current = true;
      fetch('/api/play/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: start.run.id, segments: snapshotSegments() }),
      }).catch(() => {});
    }
    if (remaining <= -400 && !finalizedRef.current) {
      finalizedRef.current = true;
      fetch('/api/play/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: start.run.id }),
      })
        .then((r) => r.ok ? r.json() : null)
        .then((j) => { if (j?.run) onDone(j.run); })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const chars = useMemo(() => {
    const out: Array<{ ch: string; cls: string }> = [];
    const passage = current.text;
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
  }, [current.text, typed]);

  if (inCountdown) {
    return (
      <div className="full-stage center">
        <span className="eyebrow amber">Final event</span>
        <div className="h2" style={{ marginTop: 10 }}>Get ready…</div>
        <div className="countdown">{countdownN > 0 ? countdownN : 'GO!'}</div>
        <div className="h3" style={{ marginTop: 10 }}>{start.player.name} · 60 seconds, one shot</div>
      </div>
    );
  }

  return (
    <div className="full-stage">
      <div className="row">
        <div className="h2" style={{ color: 'var(--amber)' }}>
          Final event · passage {segments.length + 1}
        </div>
        <div className="spacer" />
        <div className={timerClass}>{remainingS}s</div>
      </div>
      <div className="passage" style={{ marginTop: 14 }}>
        {chars.map((c, i) => (
          <span key={i} className={'ch ' + c.cls}>{c.ch === '\n' ? '\n' : c.ch}</span>
        ))}
      </div>
      <div className="h3" style={{ marginTop: 10 }}>
        Finish this one and we'll give you another — keep typing until time runs out.
      </div>
    </div>
  );
}

/* ----------------------------- Done view ----------------------------- */

// After the run ends we show the player the per-day event leaderboard with
// their row highlighted. No "play again" — this is the solo final, one shot.
function DoneView({ playerId }: { playerId: string }) {
  return (
    <div style={{ paddingTop: 'clamp(24px, 4vh, 64px)', paddingBottom: 96 }}>
      <header style={{ textAlign: 'center', marginBottom: 18 }}>
        <span className="eyebrow amber">Final event</span>
        <h1 className="h1" style={{ marginTop: 12 }}>Today's standings</h1>
      </header>
      {/* Reuse the standard LeaderboardView for now — it shows today's
         qualifying leaderboard, which the player just contributed to. The
         dedicated event leaderboard tab on the landing page is where the
         actual event ranking lives. */}
      <LeaderboardView highlightedPlayerId={playerId} showHeader={false} />
      <div style={{ position: 'fixed', bottom: 18, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 30 }}>
        <Link className="btn ghost" href="/">Back to landing</Link>
      </div>
    </div>
  );
}
