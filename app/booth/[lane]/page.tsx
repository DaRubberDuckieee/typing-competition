'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/components/api';
import { useBoothCurrent } from '@/components/useBoothCurrent';
import type { Race, Player, RacePassage } from '@/components/useBoothCurrent';
import { LeaderboardView } from '@/components/LeaderboardView';
import { friendlyError } from '@/lib/errors';
import { PASSAGES } from '@/lib/passages';
import { formatPhoneInput } from '@/lib/phone';

// Booth flow per lane:
//   /booth/1   — laptop pinned to lane 1
//   /booth/2   — laptop pinned to lane 2
//
// State machine (driven by the polled current race + local "I joined" memo):
//   - no race OR race exists but my lane is null and I haven't sat down yet
//     -> InfoForm
//   - my lane is filled but the other lane is null
//     -> WaitingForOpponent
//   - both lanes filled, status = pending (countdown)
//     -> Countdown
//   - status = running
//     -> TypingStep
//   - status = done
//     -> ResultStep  (Phase 4 will animate into the leaderboard)
//
// We track `myPlayerId` and `myRaceId` locally because the lane is keyed in
// the URL but the player's current session isn't. Once the player submits the
// InfoForm, polling stays pinned to that race until they tap Play again.

export default function BoothLanePage() {
  const { lane } = useParams<{ lane: string }>();
  const laneNum: '1' | '2' | null = lane === '1' ? '1' : lane === '2' ? '2' : null;
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [myRaceId, setMyRaceId] = useState<string | null>(null);
  const { race, p1, p2, passages, setSnapshot } = useBoothCurrent(myRaceId);
  const [returningInfo, setReturningInfo] = useState<{
    returning: boolean;
    previousBestWpm: number | null;
    previousBestScore: number | null;
  } | null>(null);

  if (!laneNum) {
    return <div className="full-stage center"><div className="h2">Invalid lane.</div></div>;
  }

  const myPlayer: Player | null = laneNum === '1' ? p1 : p2;
  const otherPlayer: Player | null = laneNum === '1' ? p2 : p1;
  const myLaneFilled = !!(race && (laneNum === '1' ? race.p1_id : race.p2_id));
  const myIdMatches = !!(myPlayerId && race && (laneNum === '1' ? race.p1_id === myPlayerId : race.p2_id === myPlayerId));

  // If the latest race doesn't have us in it (either no race exists, or it has
  // someone else in our lane), show the InfoForm so we can join the next one.
  if (!race || !myLaneFilled || !myIdMatches) {
    return (
      <InfoForm
        lane={laneNum}
        onJoined={(res) => {
          // Optimistically swap the snapshot so the page renders
          // WaitingForOpponent immediately — don't make the user stare at
          // "Joining…" while the next poll catches up. The polled state is
          // pinned to this race, so a newer active booth race cannot steal
          // focus before we show results.
          setMyPlayerId(res.playerId);
          setMyRaceId(res.race.id);
          setReturningInfo({
            returning: res.returning,
            previousBestWpm: res.previousBestWpm,
            previousBestScore: res.previousBestScore,
          });
          const passages: RacePassage[] = (res.race.passage_ids && res.race.passage_ids.length > 0
            ? res.race.passage_ids
            : [res.race.passage_id]
          ).map((pid: string) => {
            const p = PASSAGES.find((x) => x.id === pid) || PASSAGES[0];
            return { id: p.id, text: p.text };
          });
          const myPlayer: Player = {
            id: res.playerId,
            name: null,
            title: null,
            company: null,
            phone: null,
          };
          setSnapshot({
            race: res.race,
            p1: laneNum === '1' ? myPlayer : null,
            p2: laneNum === '2' ? myPlayer : null,
            passages,
          });
        }}
      />
    );
  }

  if (race.status === 'waiting') {
    return <WaitingForOpponent lane={laneNum} race={race} myPlayer={myPlayer} returningInfo={returningInfo} />;
  }
  // 'running' is the active state from countdown through to deadline. The
  // TypingStep handles the 3s countdown internally based on starts_at, then
  // flips to the actual typing UI.
  if (race.status === 'running' || race.status === 'pending') {
    return <TypingStep lane={laneNum} race={race} passages={passages} p1={p1} p2={p2} />;
  }
  // done | aborted
  return (
    <ResultStep
      lane={laneNum}
      race={race}
      p1={p1}
      p2={p2}
      onPlayAgain={() => {
        // Reset local session state. The latest race in the DB is 'done', so
        // myIdMatches becomes false and the page rerenders into InfoForm for
        // the next race. boothSitDown will create a fresh race when this
        // user submits because findOpenBoothRace excludes 'done' rows.
        setMyPlayerId(null);
        setMyRaceId(null);
        setReturningInfo(null);
      }}
    />
  );
}

/* ------------------------------ Info form ------------------------------ */

type SitDownResponse = {
  playerId: string;
  race: Race;
  returning: boolean;
  previousBestWpm: number | null;
  previousBestScore: number | null;
};

function InfoForm({
  lane,
  onJoined,
}: {
  lane: '1' | '2';
  onJoined: (res: SitDownResponse) => void;
}) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  // Tri-state: idle (form open) → submitting (request in flight) → joined
  // (request succeeded; parent should be unmounting us — if it isn't, the
  // "still loading?" hint surfaces a refresh fallback).
  const [step, setStep] = useState<'idle' | 'submitting' | 'joined'>('idle');
  const [showRefreshHint, setShowRefreshHint] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accent = lane === '1' ? 'var(--cyan)' : 'var(--amber)';
  // Phone needs 10+ digits to be plausibly real (US conference; the server
  // normalizer agrees). The button stays disabled until that's satisfied so
  // the user can't fire off a doomed request.
  const phoneDigits = phone.replace(/\D+/g, '');
  const phoneOk = phoneDigits.length >= 10 && phoneDigits.length <= 15;
  const valid = name.trim().length > 0 && company.trim().length > 0 && phoneOk;

  async function submit() {
    if (!valid || step !== 'idle') return;
    setStep('submitting'); setErr(null);
    // Hard 10s ceiling so a hung sit-down request doesn't pin the form on
    // "Joining…" forever. Anything legit completes well under this.
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await fetch('/api/booth/sit-down', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lane,
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
      // Parent will optimistically rerender into WaitingForOpponent — but
      // if for some reason it doesn't (stale snapshot, race bug), our
      // 'joined' state ensures the user sees "Joined!" instead of
      // perpetual "Joining…", and the refresh hint kicks in after 4s.
      setStep('joined');
      onJoined({
        playerId: j.playerId,
        race: j.race,
        returning: !!j.returning,
        previousBestWpm: j.previousBestWpm ?? null,
        previousBestScore: j.previousBestScore ?? null,
      });
    } catch (e: any) {
      clearTimeout(timeoutId);
      // friendlyError handles every flavor: thrown app codes, Postgres /
      // PostgREST raw text, AbortError from our 10s timeout, network drops.
      setErr(friendlyError(e));
      setStep('idle');
    }
  }

  // If we're stuck in 'joined' for >4s, the parent isn't unmounting us as
  // expected — surface a "reload page" escape hatch so the user isn't
  // trapped on a stale screen.
  useEffect(() => {
    if (step !== 'joined') return;
    const t = setTimeout(() => setShowRefreshHint(true), 4000);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div className="full-stage" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 'clamp(48px, 10vh, 120px)' }}>
      <span className="eyebrow" style={{ color: accent }}>Player {lane}</span>
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
          // Auto-format US/NANP as the user types (1112223333 → 111 222 3333)
          // and falls through to a generic chunked format for + international
          // numbers. We keep the leading + if the user typed it so the server
          // routes them as international rather than auto-prefixing +1.
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
        <button
          className="btn big"
          disabled={!valid || step !== 'idle'}
          onClick={submit}
        >
          {step === 'submitting' ? 'Joining…' : step === 'joined' ? 'Joined! Loading…' : 'Join the race'}
        </button>
        {err && <div style={{ marginTop: 14 }}><span className="pill err">{err}</span></div>}
        {showRefreshHint && step === 'joined' && (
          <div style={{ marginTop: 14 }}>
            <button
              className="btn ghost"
              onClick={() => window.location.reload()}
              style={{ fontSize: 12 }}
            >
              Still loading? Tap to refresh.
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <Link className="btn ghost" href="/">Back</Link>
      </div>
    </div>
  );
}

/* ----------------------------- Waiting step ----------------------------- */

function WaitingForOpponent({
  lane, race, myPlayer, returningInfo,
}: {
  lane: '1' | '2';
  race: Race;
  myPlayer: Player | null;
  returningInfo: { returning: boolean; previousBestWpm: number | null; previousBestScore: number | null } | null;
}) {
  const accent = lane === '1' ? 'var(--cyan)' : 'var(--amber)';
  return (
    <div className="full-stage" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 'clamp(48px, 10vh, 120px)' }}>
      <span className="eyebrow" style={{ color: accent }}>Player {lane} · {myPlayer?.name || ''}</span>
      <h1 className="h1" style={{ marginTop: 14 }}>You're in.</h1>
      <p className="h3" style={{ marginTop: 14, maxWidth: 560 }}>
        Waiting for player {lane === '1' ? '2' : '1'} to step up to the other laptop.
      </p>

      {returningInfo?.returning && (
        <div className="card" style={{ marginTop: 28, maxWidth: 480 }}>
          <span className="eyebrow ok">Welcome back</span>
          <div className="h2" style={{ marginTop: 8 }}>
            Beat your personal best.
          </div>
          <div className="row-wrap" style={{ marginTop: 14, justifyContent: 'center' }}>
            <span className="pill ok">
              Best WPM: {returningInfo.previousBestWpm ?? '—'}
            </span>
            <span className="pill ok">
              Best score: {returningInfo.previousBestScore ?? '—'}
            </span>
          </div>
        </div>
      )}

      <div className="row-wrap" style={{ marginTop: 32, justifyContent: 'center' }}>
        <span className="pill ok"><span className="status-dot ok" /> You're in</span>
        <span className="pill"><span className="status-dot" /> Waiting for opponent</span>
      </div>

      <RestartButton />
    </div>
  );
}

/* ----------------------------- Typing step ------------------------------ */

// Multi-passage typing step. Both lanes share the same ordered passage list
// (race.passage_ids). When a player completes the current passage, we push it
// into a `segments` array, advance to the next passage, and reset the typed
// buffer. Server-side scoring sums across all completed segments + the final
// in-progress one.
type Segment = { passageId: string; typed: string; elapsedMs: number };

function TypingStep({
  lane, race, passages, p1, p2,
}: {
  lane: '1' | '2';
  race: Race;
  passages: RacePassage[];
  p1: Player | null;
  p2: Player | null;
}) {
  const accent = lane === '1' ? 'var(--cyan)' : 'var(--amber)';
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(iv);
  }, []);
  const startsAt = race.starts_at ? new Date(race.starts_at).getTime() : 0;
  const endsAt = race.ends_at ? new Date(race.ends_at).getTime() : 0;
  const inCountdown = now < startsAt;
  const countdownN = Math.ceil((startsAt - now) / 1000);
  const remainingS = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const timerClass = remainingS <= 5 ? 'timer err' : remainingS <= 15 ? 'timer warn' : 'timer';

  const [passageIdx, setPassageIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  // Wall-clock ms when the current segment started typing.
  const segStartRef = useRef<number>(0);
  const finalSubmittedRef = useRef(false);

  const safePassages = passages.length > 0 ? passages : [{ id: race.passage_id, text: '' }];
  const current = safePassages[passageIdx % safePassages.length];

  // When countdown ends, mark segment 1 start.
  useEffect(() => {
    if (!inCountdown && segStartRef.current === 0) {
      segStartRef.current = Math.max(Date.now(), startsAt);
    }
  }, [inCountdown, startsAt]);

  // Compose snapshot to submit: completed segments + current in-progress.
  function snapshotSegments(): Segment[] {
    const elapsed = Math.max(0, Date.now() - (segStartRef.current || Date.now()));
    const inProgress: Segment = { passageId: current.id, typed, elapsedMs: elapsed };
    return typed.length > 0 || segments.length === 0
      ? [...segments, inProgress]
      : [...segments];
  }

  // Keystrokes (only after countdown). We cap typed length at exactly the
  // passage length — there's no overshoot buffer because we auto-advance
  // the moment the cursor reaches the end (see effect below).
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

  // Auto-advance when the cursor reaches the end of the current passage.
  // Previously this required a *perfect* match (typed === current.text),
  // which trapped players on hard typos. Now we advance on length —
  // wrong characters still cost accuracy (scoring is character-by-character
  // server-side), so there's no incentive to bash through carelessly.
  useEffect(() => {
    if (inCountdown) return;
    if (typed.length < current.text.length) return;
    const segEnd = Date.now();
    const elapsedMs = Math.max(1, segEnd - (segStartRef.current || segEnd));
    setSegments((s) => [...s, { passageId: current.id, typed, elapsedMs }]);
    setTyped('');
    setPassageIdx((i) => (i + 1) % safePassages.length);
    segStartRef.current = segEnd;
  }, [typed, current, inCountdown, safePassages.length]);

  // Live progress submit every 300ms (final: false).
  useEffect(() => {
    if (inCountdown) return;
    const iv = setInterval(() => {
      fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raceId: race.id,
          lane: `p${lane}`,
          segments: snapshotSegments(),
          final: false,
        }),
      }).catch(() => {});
    }, 300);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCountdown, typed, segments, passageIdx]);

  // Final submit + finalize at deadline.
  useEffect(() => {
    if (inCountdown) return;
    const remaining = endsAt - now;
    if (remaining <= 250 && !finalSubmittedRef.current) {
      finalSubmittedRef.current = true;
      fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raceId: race.id,
          lane: `p${lane}`,
          segments: snapshotSegments(),
          final: true,
        }),
      }).catch(() => {});
    }
    if (remaining <= -400) {
      fetch('/api/race/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raceId: race.id }),
      }).catch(() => {});
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
        <span className="eyebrow" style={{ color: accent }}>Player {lane}</span>
        <div className="h2" style={{ marginTop: 10 }}>Get ready…</div>
        <div className="countdown">{countdownN > 0 ? countdownN : 'GO!'}</div>
        <div className="h3" style={{ marginTop: 10 }}>{p1?.name || 'Player 1'} vs. {p2?.name || 'Player 2'}</div>
        <RestartButton />
      </div>
    );
  }

  return (
    <div className="full-stage">
      <div className="row">
        <div className="h2" style={{ color: accent }}>Player {lane} · passage {segments.length + 1}</div>
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
      <RestartButton />
    </div>
  );
}

/* ----------------------------- Result step ----------------------------- */

// Two phases:
//   - 'flash': full-screen color flood, huge verdict, animated counters,
//     confetti for the winner, today's rank pill (shown for winner AND
//     loser). Held until the user clicks Continue.
//   - 'leaderboard': the player's row pulses on the top-20 and they can
//     hit Play again to start a fresh race.
function ResultStep({
  lane, race, p1, p2, onPlayAgain,
}: {
  lane: '1' | '2';
  race: Race;
  p1: Player | null;
  p2: Player | null;
  onPlayAgain: () => void;
}) {
  const [phase, setPhase] = useState<'flash' | 'leaderboard'>('flash');
  const myId = lane === '1' ? race.p1_id : race.p2_id;

  if (phase === 'leaderboard') {
    return (
      <div style={{ paddingTop: 'clamp(24px, 4vh, 64px)', paddingBottom: 96 }}>
        <LeaderboardView
          highlightedPlayerId={myId}
          lockToLane={lane}
          onPlayNow={onPlayAgain}
          showHeader
        />
        <RestartButton />
      </div>
    );
  }

  return (
    <ResultFlash
      lane={lane}
      race={race}
      p1={p1}
      p2={p2}
      onContinue={() => setPhase('leaderboard')}
    />
  );
}

function ResultFlash({
  lane, race, p1, p2, onContinue,
}: {
  lane: '1' | '2';
  race: Race;
  p1: Player | null;
  p2: Player | null;
  onContinue: () => void;
}) {
  const myPlayer = lane === '1' ? p1 : p2;
  const my = lane === '1'
    ? { score: race.p1_score, wpm: race.p1_wpm, acc: race.p1_acc }
    : { score: race.p2_score, wpm: race.p2_wpm, acc: race.p2_acc };
  const myId = lane === '1' ? race.p1_id : race.p2_id;
  const isWinner = !!(race.winner_id && race.winner_id === myId);
  const isTie = race.winner_id == null && race.status === 'done';
  const variant = isTie ? 'is-tie' : isWinner ? 'is-winner' : 'is-loser';
  const verdict = isTie ? 'TIE' : isWinner ? 'YOU WON' : 'YOU LOST';

  // Fetch today's leaderboard once to surface this player's rank under the
  // verdict. Retry once after 600ms in case finalizeRace hasn't fully
  // propagated to the leaderboard query by the time the flash mounts.
  const [rank, setRank] = useState<number | null>(null);
  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/leaderboard?scope=today', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        const idx = (j.rows || []).findIndex((row: any) => row.player_id === myId);
        if (!cancelled && idx >= 0) setRank(idx + 1);
      } catch {}
    }
    load();
    const t = setTimeout(load, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [myId]);

  return (
    <div className={'booth-flash ' + variant}>
      {isWinner && <Confetti />}
      <span className="eyebrow" style={{ color: isWinner ? 'var(--ok)' : isTie ? 'var(--fg)' : 'var(--mars)' }}>
        Player {lane} · {myPlayer?.name || ''}
      </span>
      <h1 className="booth-flash__verdict">{verdict}</h1>
      {rank != null && (
        <div className="booth-flash__rank">
          You ranked <span className="booth-flash__rank-num">#{rank}</span> today
        </div>
      )}
      <div className="booth-flash__stats">
        <Stat label="WPM" target={my.wpm} />
        <Stat label="Accuracy" target={my.acc} suffix="%" />
        <Stat label="Score" target={my.score} />
      </div>
      <div className="row-wrap" style={{ marginTop: 'clamp(28px, 5vw, 56px)', justifyContent: 'center' }}>
        <button className="btn huge" onClick={onContinue}>Continue</button>
      </div>
      <RestartButton />
    </div>
  );
}

// Animated count-up. Eases into the target value over 1.2s. Tabular numerals
// in the CSS keep the digits from jittering as they tick.
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
      // ease-out cubic
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
        {target == null ? '—' : `${Math.round(val * 10) / 10}${suffix || ''}`}
      </div>
    </div>
  );
}

// Pure-CSS confetti rain. 32 elements with randomized colors / horizontal
// positions / fall durations / rotations — cheap and looks decent.
function Confetti() {
  const colors = ['#7DD3FC', '#F6B66A', '#5FA8A3', '#C97A4A', '#E6EDF3'];
  const pieces = useMemo(
    () =>
      Array.from({ length: 32 }).map((_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 2,
        duration: 2.5 + Math.random() * 1.5,
        color: colors[i % colors.length],
        rotate: Math.random() * 360,
      })),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/* ----------------------------- Restart button ----------------------------- */

// Persistent at the bottom of every booth screen — the user can always bail
// back to the landing page (which is also the leaderboard).
function RestartButton() {
  return (
    <div style={{ position: 'fixed', bottom: 18, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 30 }}>
      <Link className="btn ghost" href="/">Restart</Link>
    </div>
  );
}
