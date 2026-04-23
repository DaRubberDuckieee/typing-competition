'use client';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/components/api';
import { useAppState } from '@/components/useAppState';

// Solo "Play" flow:
//   1. Mount → POST /api/play/start → server assigns a space-themed name + a
//      run, and returns every passage's text so we can cycle client-side.
//   2. Running (30s) → 3-2-1 countdown, then type. When you finish the
//      passage, we roll to the next one automatically and the timer keeps
//      ticking. Score is summed across everything you typed.
//   3. Done → stats tiles + inline leaderboard + rename box.

type Run = {
  id: string; event_day: string; player_id: string; passage_id: string;
  duration_s: number; starts_at: string; ends_at: string;
  status: 'pending' | 'done' | 'aborted';
  score: number | null; wpm: number | null; acc: number | null; errors: any;
};
type PassageRef = { id: string; text: string };
type Segment = { passageId: string; typed: string; elapsedMs: number };

export default function PlayPage() {
  const [step, setStep] = useState<'starting' | 'running' | 'done'>('starting');
  const [run, setRun] = useState<Run | null>(null);
  const [passages, setPassages] = useState<PassageRef[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{
          run: Run;
          player: { id: string; name: string };
          passages: PassageRef[];
        }>('/api/play/start', {
          method: 'POST',
          body: JSON.stringify({ durationS: 30 }),
        });
        setRun(r.run);
        setPassages(r.passages);
        setPlayerName(r.player.name);
        setStep('running');
      } catch (e: any) { setErr(e.message || 'could not start'); }
    })();
  }, []);

  // Poll as a safety net.
  useEffect(() => {
    if (step !== 'running' || !run) return;
    const iv = setInterval(async () => {
      try {
        const full = await api<{ run: Run }>(`/api/play/${run.id}`);
        if (full.run.status === 'done') {
          setRun(full.run);
          setStep('done');
        }
      } catch {}
    }, 1500);
    return () => clearInterval(iv);
  }, [step, run]);

  if (err) {
    return (
      <div className="full-stage center">
        <div className="h1" style={{ color: 'var(--err)' }}>Couldn't start</div>
        <div className="h3">{err}</div>
        <div style={{ marginTop: 18 }}>
          <Link className="btn" href="/play">Try again</Link>
        </div>
      </div>
    );
  }
  if (step === 'starting' || !run || passages.length === 0) {
    return <div className="full-stage center"><div className="h2">Loading…</div></div>;
  }
  if (step === 'running') {
    return (
      <RunningStep
        run={run}
        passages={passages}
        onDone={(r) => { setRun(r); setStep('done'); }}
      />
    );
  }
  return <DoneStep run={run} initialName={playerName} />;
}

function RunningStep({
  run, passages, onDone,
}: {
  run: Run; passages: PassageRef[]; onDone: (r: Run) => void;
}) {
  const startsAt = useMemo(() => new Date(run.starts_at).getTime(), [run.starts_at]);
  const endsAt = useMemo(() => new Date(run.ends_at).getTime(), [run.ends_at]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(iv);
  }, []);

  const inCountdown = now < startsAt;
  const countdownN = Math.ceil((startsAt - now) / 1000);
  const remainingS = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const timerClass = remainingS <= 5 ? 'timer err' : remainingS <= 15 ? 'timer warn' : 'timer';

  // Passage cycle. Start with the passage the server picked; after each
  // completion roll to the next one in PASSAGES order.
  const [passageIdx, setPassageIdx] = useState(() =>
    Math.max(0, passages.findIndex((p) => p.id === run.passage_id))
  );
  const [typed, setTyped] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const segStartRef = useRef<number>(0); // wall-clock ms when current segment started
  const finalizedRef = useRef(false);
  const submittedOnceRef = useRef(false);

  // When countdown flips to "running", mark the start of segment 1.
  useEffect(() => {
    if (!inCountdown && segStartRef.current === 0) {
      segStartRef.current = Math.max(Date.now(), startsAt);
    }
  }, [inCountdown, startsAt]);

  const current = passages[passageIdx];

  // Keystrokes.
  useEffect(() => {
    if (inCountdown) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Backspace') { e.preventDefault(); setTyped((t) => t.slice(0, -1)); return; }
      if (e.key === 'Tab')       { e.preventDefault(); setTyped((t) => t + '  '); return; }
      if (e.key === 'Enter')     { e.preventDefault(); setTyped((t) => t + '\n'); return; }
      if (e.key.length === 1) {
        e.preventDefault();
        setTyped((t) => (t.length >= current.text.length + 5 ? t : t + e.key));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inCountdown, current.text.length]);

  // Roll to next passage when the user finishes the current one.
  useEffect(() => {
    if (inCountdown) return;
    if (typed !== current.text) return;
    const segEnd = Date.now();
    const elapsedMs = Math.max(1, segEnd - segStartRef.current);
    setSegments((s) => [...s, { passageId: current.id, typed, elapsedMs }]);
    setTyped('');
    setPassageIdx((i) => (i + 1) % passages.length);
    segStartRef.current = segEnd;
  }, [typed, current, inCountdown, passages.length]);

  // Periodic submit of in-progress progress (every 1s) so the server has
  // something if the browser dies. Cheap since it's just a PATCH.
  useEffect(() => {
    if (inCountdown) return;
    const iv = setInterval(() => { pushProgress(false); }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCountdown, typed, segments, passageIdx]);

  // Timer expiry → final submit + finalize.
  useEffect(() => {
    if (inCountdown) return;
    const remaining = endsAt - now;
    if (remaining <= 250 && !submittedOnceRef.current) {
      submittedOnceRef.current = true;
      pushProgress(true);
    } else if (remaining <= -500) {
      doFinalize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, inCountdown]);

  // Compose the snapshot to send: completed segments + current in-progress.
  function snapshotSegments(): Segment[] {
    const nowMs = Date.now();
    const partialElapsed = Math.max(0, nowMs - segStartRef.current);
    const inProgress: Segment = {
      passageId: current.id,
      typed,
      elapsedMs: partialElapsed,
    };
    return typed.length > 0 || segments.length === 0
      ? [...segments, inProgress]
      : [...segments];
  }

  async function pushProgress(finalize: boolean) {
    try {
      await api('/api/play/submit', {
        method: 'POST',
        body: JSON.stringify({ runId: run.id, segments: snapshotSegments() }),
      });
      if (finalize) await doFinalize();
    } catch {}
  }

  async function doFinalize() {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    try {
      const r = await api<{ run: Run }>('/api/play/finalize', {
        method: 'POST', body: JSON.stringify({ runId: run.id }),
      });
      if (r.run?.status === 'done') onDone(r.run);
    } catch { finalizedRef.current = false; }
  }

  if (inCountdown) {
    return (
      <div className="full-stage center">
        <div className="h2">Get ready…</div>
        <div className="countdown">{countdownN > 0 ? countdownN : 'GO!'}</div>
        <div className="h3">30 seconds · type as many passages as you can</div>
      </div>
    );
  }

  return (
    <div className="full-stage">
      <div className="row">
        <div className="h2" style={{ color: 'var(--p1)' }}>
          Solo run · passage {segments.length + 1}
        </div>
        <div className="spacer" />
        <div className={timerClass}>{remainingS}s</div>
      </div>
      <RenderedPassage passage={current.text} typed={typed} />
      <div className="h3" style={{ marginTop: 10 }}>
        Finish this passage and we'll give you another — keep typing until time runs out.
      </div>
    </div>
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

function DoneStep({ run, initialName }: { run: Run; initialName: string }) {
  const { state, refresh } = useAppState();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const serverBoard = state?.leaderboard || [];

  // Merge the current run into the server leaderboard client-side so the user
  // is always visible at the correct rank — regardless of Realtime lag or any
  // server-side aggregation weirdness.
  const board = useMemo(() => {
    const myScore = Number(run.score ?? 0);
    const myAcc = Number(run.acc ?? 0);
    const myNowIso = new Date().toISOString();
    const myName = savedAs || initialName;
    const idx = serverBoard.findIndex((r) => r.player_id === run.player_id);
    let rows = [...serverBoard];
    if (idx < 0) {
      rows.push({
        player_id: run.player_id,
        name: myName,
        title: null,
        company: null,
        best_score: myScore,
        best_acc: myAcc,
        best_at: myNowIso,
      } as any);
    } else {
      // Keep the better of (server's stored best, this run). Replace the
      // display name with the latest one we know about.
      const existing = rows[idx];
      const keepCurrent = myScore > (existing.best_score ?? 0);
      rows[idx] = {
        ...existing,
        name: myName,
        best_score: keepCurrent ? myScore : existing.best_score,
        best_acc: keepCurrent ? myAcc : existing.best_acc,
        best_at: keepCurrent ? myNowIso : existing.best_at,
      };
    }
    // NOTE: the trailing `? 1 : -1` must be parenthesised. Without parens,
    // JS parses it as `(A || B || C) ? 1 : -1`, which breaks the sort into
    // "everything returns 1" and just preserves insertion order.
    rows.sort(
      (a, b) =>
        (b.best_score ?? 0) - (a.best_score ?? 0) ||
        (b.best_acc ?? 0) - (a.best_acc ?? 0) ||
        ((a.best_at || '') > (b.best_at || '') ? 1 : -1)
    );
    return rows.slice(0, 20);
  }, [serverBoard, run.player_id, run.score, run.acc, savedAs, initialName]);

  const myIdx = board.findIndex((r) => r.player_id === run.player_id);
  const myRank = myIdx >= 0 ? myIdx + 1 : null;
  const displayName = savedAs || (myIdx >= 0 ? board[myIdx].name : initialName);

  const saveName = useCallback(async () => {
    setSaving(true); setErr(null); setSavedAs(null);
    try {
      const r = await api<{ player: { name: string } }>(
        `/api/player/${run.player_id}/rename`,
        { method: 'POST', body: JSON.stringify({ name }) }
      );
      setSavedAs(r.player.name);
      setName(r.player.name);
      // Force an immediate state refetch so the leaderboard below updates
      // without waiting on the Realtime round-trip.
      refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }, [name, run.player_id, refresh]);

  const formula = run.wpm != null && run.acc != null
    ? `Score = WPM × (Acc/100)² × 10 = ${run.wpm} × (${run.acc}/100)² × 10 = ${run.score}`
    : 'Score not available';

  return (
    <div className="full-stage">
      <span className="eyebrow amber">Run complete</span>
      <div className="h1" style={{ marginTop: 14, marginBottom: 24 }}>Nice run.</div>

      <div className="grid2" style={{ marginBottom: 18 }}>
        <div className="tile"><div className="lbl">WPM</div><div className="big">{run.wpm ?? '—'}</div></div>
        <div className="tile"><div className="lbl">Accuracy</div><div className="big">{run.acc ?? '—'}%</div></div>
        <div className="tile hoverable" style={{ gridColumn: '1 / span 2' }} title={formula}>
          <div className="lbl">Overall score <span style={{ opacity: 0.6 }}>(hover for formula)</span></div>
          <div className="big">{run.score ?? '—'}</div>
          <div className="hint">
            <div><b>Score = WPM × (Accuracy/100)² × 10</b></div>
            <div style={{ opacity: 0.8, marginTop: 4 }}>
              = {run.wpm ?? '—'} × ({run.acc ?? '—'}/100)² × 10 = {run.score ?? '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="row-wrap" style={{ marginBottom: 22 }}>
        <Link className="btn" href="/play">Play again</Link>
      </div>

      <div className="card" style={{ marginBottom: 28 }}>
        <span className="eyebrow">Want to use your real name?</span>
        <div className="row-wrap" style={{ marginTop: 14 }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="your name"
            style={{ maxWidth: 420 }}
          />
          <button className="btn ghost" disabled={saving || !name.trim()} onClick={saveName}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {savedAs && <div style={{ marginTop: 12 }}><span className="pill ok">saved as {savedAs}</span></div>}
        {err && <div style={{ marginTop: 12 }}><span className="pill err">{err}</span></div>}
      </div>

      <div className="h2" style={{ marginBottom: 14 }}>Leaderboard</div>
      <div className="card">
        <table className="lb">
          <thead>
            <tr>
              <th>Rank</th><th>Name</th>
              <th style={{ textAlign: 'right' }}>Score</th>
              <th style={{ textAlign: 'right' }}>Acc</th>
            </tr>
          </thead>
          <tbody>
            {board.length === 0 && (
              <tr><td colSpan={4} className="center h3">No scores yet — you'll be first.</td></tr>
            )}
            {board.map((r, i) => {
              const isMe = r.player_id === run.player_id;
              const rank = i + 1;
              const cls = [
                rank <= 5 ? 'top' : '',
                rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '',
                isMe ? 'you' : '',
              ].filter(Boolean).join(' ');
              return (
                <tr key={r.player_id} className={cls}>
                  <td><span className="rank">#{rank}</span></td>
                  <td>
                    {r.name}
                    {isMe && <span className="pill ok" style={{ marginLeft: 10 }}>you</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.best_score}</td>
                  <td style={{ textAlign: 'right' }}>{r.best_acc}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
