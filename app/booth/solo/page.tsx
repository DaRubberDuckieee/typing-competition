'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/components/api';
import { LeaderboardView } from '@/components/LeaderboardView';
import { friendlyError } from '@/lib/errors';
import { formatPhoneInput } from '@/lib/phone';

type SoloRun = {
  id: string;
  event_day: string;
  player_id: string;
  passage_id: string;
  duration_s: number;
  starts_at: string;
  ends_at: string;
  status: 'pending' | 'done' | 'aborted';
  score: number | null;
  wpm: number | null;
  acc: number | null;
};

type BoothSoloStart = {
  run: SoloRun;
  player: { id: string; name: string; company: string | null };
  passages: { id: string; text: string }[];
  returning: boolean;
  previousBestWpm: number | null;
  previousBestScore: number | null;
};

type Segment = { passageId: string; typed: string; elapsedMs: number };

type Phase =
  | { kind: 'form' }
  | { kind: 'running'; start: BoothSoloStart }
  | { kind: 'flash'; start: BoothSoloStart; run: SoloRun }
  | { kind: 'leaderboard'; start: BoothSoloStart; run: SoloRun };

export default function BoothSoloPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });

  if (phase.kind === 'form') {
    return <InfoForm onStarted={(start) => setPhase({ kind: 'running', start })} />;
  }

  if (phase.kind === 'running') {
    return (
      <TypingStep
        start={phase.start}
        onDone={(run) => setPhase({ kind: 'flash', start: phase.start, run })}
      />
    );
  }

  if (phase.kind === 'flash') {
    return (
      <ResultFlash
        run={phase.run}
        player={phase.start.player}
        onContinue={() => setPhase({ kind: 'leaderboard', start: phase.start, run: phase.run })}
      />
    );
  }

  return (
    <div style={{ paddingTop: 'clamp(24px, 4vh, 64px)', paddingBottom: 96 }}>
      <LeaderboardView
        highlightedPlayerId={phase.start.player.id}
        showRestartCta
        showHeader
      />
    </div>
  );
}

function InfoForm({ onStarted }: { onStarted: (start: BoothSoloStart) => void }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'idle' | 'submitting'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const phoneDigits = phone.replace(/\D+/g, '');
  const phoneOk = phoneDigits.length >= 10 && phoneDigits.length <= 15;
  const valid = name.trim().length > 0 && company.trim().length > 0 && phoneOk;

  async function submit() {
    if (!valid || step !== 'idle') return;
    setStep('submitting');
    setErr(null);
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await fetch('/api/booth/solo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          company: company.trim(),
          phone: phone.trim(),
        }),
        cache: 'no-store',
        signal: ctrl.signal,
      });
      clearTimeout(timeoutId);
      const text = await r.text();
      const j = text ? JSON.parse(text) : {};
      if (!r.ok) throw new Error(j.error || r.statusText);
      onStarted(j as BoothSoloStart);
    } catch (e: any) {
      clearTimeout(timeoutId);
      setErr(friendlyError(e));
      setStep('idle');
    }
  }

  return (
    <div className="full-stage" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 'clamp(48px, 10vh, 120px)' }}>
      <span className="eyebrow amber">Solo run</span>
      <h1 className="h1" style={{ marginTop: 14 }}>Step up.</h1>
      <p className="h3" style={{ marginTop: 14, maxWidth: 540 }}>
        Tell us who you are. We use your phone only so we can recognize you across days of the conference.
      </p>

      <div className="card" style={{ width: '100%', maxWidth: 480, marginTop: 36, textAlign: 'left' }}>
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jess Wang" autoFocus />
        <label>Company</label>
        <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Braintrust" />
        <label>Phone</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
          placeholder="555 123 4567 or +44 7700 900123"
          inputMode="tel"
          autoComplete="tel"
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <p className="h3" style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
          US numbers auto-format. For international, start with + and your country code.
        </p>
        <div style={{ height: 18 }} />
        <button className="btn big" disabled={!valid || step !== 'idle'} onClick={submit}>
          {step === 'submitting' ? 'Starting...' : 'Start solo run'}
        </button>
        {err && <div style={{ marginTop: 14 }}><span className="pill err">{err}</span></div>}
      </div>

      <div style={{ marginTop: 24 }}>
        <Link className="btn ghost" href="/">Back</Link>
      </div>
    </div>
  );
}

function TypingStep({
  start,
  onDone,
}: {
  start: BoothSoloStart;
  onDone: (run: SoloRun) => void;
}) {
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

  const passages = start.passages.length > 0 ? start.passages : [{ id: start.run.passage_id, text: '' }];
  const [passageIdx, setPassageIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const segStartRef = useRef<number>(0);
  const finalSubmittedRef = useRef(false);
  const finalizedRef = useRef(false);

  const current = passages[passageIdx % passages.length];

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

  async function pushProgress() {
    await api('/api/play/submit', {
      method: 'POST',
      body: JSON.stringify({ runId: start.run.id, segments: snapshotSegments() }),
    });
  }

  async function doFinalize() {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    try {
      await pushProgress();
      const r = await api<{ run: SoloRun }>('/api/play/finalize', {
        method: 'POST',
        body: JSON.stringify({ runId: start.run.id }),
      });
      if (r.run?.status === 'done') onDone(r.run);
    } catch {
      finalizedRef.current = false;
    }
  }

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

  useEffect(() => {
    if (inCountdown) return;
    if (typed.length < current.text.length) return;
    const segEnd = Date.now();
    const elapsedMs = Math.max(1, segEnd - (segStartRef.current || segEnd));
    setSegments((s) => [...s, { passageId: current.id, typed, elapsedMs }]);
    setTyped('');
    setPassageIdx((i) => (i + 1) % passages.length);
    segStartRef.current = segEnd;
  }, [typed, current, inCountdown, passages.length]);

  useEffect(() => {
    if (inCountdown) return;
    const iv = setInterval(() => {
      pushProgress().catch(() => {});
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCountdown, typed, segments, passageIdx]);

  useEffect(() => {
    if (inCountdown) return;
    const remaining = endsAt - now;
    if (remaining <= 250 && !finalSubmittedRef.current) {
      finalSubmittedRef.current = true;
      pushProgress().catch(() => {});
    }
    if (remaining <= -500) {
      doFinalize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, inCountdown]);

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
      <div className="full-stage center" style={{ alignItems: 'center', paddingTop: 'clamp(36px, 8vh, 96px)' }}>
        <span className="eyebrow amber">Solo run · {start.player.name}</span>
        <div className="h2" style={{ marginTop: 10 }}>Get ready...</div>
        <div className="countdown">{countdownN > 0 ? countdownN : 'GO!'}</div>
        <div className="h3">60 seconds · type as many passages as you can</div>
        {start.returning && (
          <div className="card" style={{ marginTop: 28, maxWidth: 480 }}>
            <span className="eyebrow ok">Welcome back</span>
            <div className="h2" style={{ marginTop: 8 }}>Beat your personal best.</div>
            <div className="row-wrap" style={{ marginTop: 14, justifyContent: 'center' }}>
              <span className="pill ok">Best WPM: {start.previousBestWpm ?? '-'}</span>
              <span className="pill ok">Best score: {start.previousBestScore ?? '-'}</span>
            </div>
          </div>
        )}
        <RestartButton />
      </div>
    );
  }

  return (
    <div className="full-stage">
      <div className="row">
        <div className="h2" style={{ color: 'var(--amber)' }}>Solo run · passage {segments.length + 1}</div>
        <div className="spacer" />
        <div className={timerClass}>{remainingS}s</div>
      </div>
      <div className="passage" style={{ marginTop: 14 }}>
        {chars.map((c, i) => (
          <span key={i} className={'ch ' + c.cls}>{c.ch === '\n' ? '\n' : c.ch}</span>
        ))}
      </div>
      <div className="h3" style={{ marginTop: 10 }}>
        Finish this one and we'll give you another - keep typing until time runs out.
      </div>
      <RestartButton />
    </div>
  );
}

function ResultFlash({
  run,
  player,
  onContinue,
}: {
  run: SoloRun;
  player: { id: string; name: string };
  onContinue: () => void;
}) {
  const [rank, setRank] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/leaderboard?scope=today', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        const idx = (j.rows || []).findIndex((row: any) => row.player_id === player.id);
        if (!cancelled && idx >= 0) setRank(idx + 1);
      } catch {}
    }
    load();
    const t = setTimeout(load, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [player.id]);

  return (
    <div className="booth-flash is-tie">
      <span className="eyebrow amber">Solo run · {player.name}</span>
      <h1 className="booth-flash__verdict">RUN COMPLETE</h1>
      {rank != null && (
        <div className="booth-flash__rank">
          You ranked <span className="booth-flash__rank-num">#{rank}</span> today
        </div>
      )}
      <div className="booth-flash__stats">
        <Stat label="WPM" target={run.wpm} />
        <Stat label="Accuracy" target={run.acc} suffix="%" />
        <Stat label="Score" target={run.score} />
      </div>
      <div className="row-wrap" style={{ marginTop: 'clamp(28px, 5vw, 56px)', justifyContent: 'center' }}>
        <button className="btn huge" onClick={onContinue}>Continue</button>
      </div>
      <RestartButton />
    </div>
  );
}

function Stat({ label, target, suffix }: { label: string; target: number | null; suffix?: string }) {
  const t = target ?? 0;
  const [val, setVal] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const dur = 1200;
    let raf = 0;
    const tick = () => {
      const elapsed = Date.now() - start;
      const ratio = Math.min(1, elapsed / dur);
      const eased = 1 - Math.pow(1 - ratio, 3);
      setVal(t * eased);
      if (ratio < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [t]);
  return (
    <div className="booth-flash__stat">
      <div className="lbl">{label}</div>
      <div className="num">
        {target == null ? '-' : `${Math.round(val * 10) / 10}${suffix || ''}`}
      </div>
    </div>
  );
}

function RestartButton() {
  return (
    <div style={{ position: 'fixed', bottom: 18, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 30 }}>
      <Link className="btn ghost" href="/">Restart</Link>
    </div>
  );
}
