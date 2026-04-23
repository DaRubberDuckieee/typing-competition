'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/components/api';
import { useRoom } from '@/components/useRoom';

// Spectator / host view. Three URLs are shared from this page:
//   /h2h/[id]           (this page, split-screen view)
//   /h2h/[id]/1         (player 1 typing lane)
//   /h2h/[id]/2         (player 2 typing lane)

export default function SpectatorPage() {
  const { id } = useParams<{ id: string }>();
  const { room, passageText, error } = useRoom(id);

  if (error) return <div className="h2" style={{ padding: 40 }}>Room not found.</div>;
  if (!room) return <div className="h2" style={{ padding: 40 }}>Loading room…</div>;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const p1Url = `${origin}/h2h/${room.id}/1`;
  const p2Url = `${origin}/h2h/${room.id}/2`;
  const viewUrl = `${origin}/h2h/${room.id}`;

  if (room.status === 'done') {
    return <Results room={room} />;
  }

  if (room.status === 'running') {
    return <LiveView room={room} passageText={passageText} />;
  }

  return (
    <div className="full-stage">
      <span className="eyebrow amber">Instant 1v1 · Room {room.id}</span>
      <h1 className="h1" style={{ marginTop: 14 }}>Waiting room</h1>
      <p className="h3" style={{ marginTop: 14, maxWidth: 640 }}>
        Share one link with each player, and keep this page open on a projector
        or spectator screen. When both players are ready, press start.
      </p>

      <div className="grid2" style={{ marginTop: 40 }}>
        <UrlCard
          label="Player 1"
          url={p1Url}
          accent="var(--cyan)"
          joined={!!room.p1_name}
          name={room.p1_name}
        />
        <UrlCard
          label="Player 2"
          url={p2Url}
          accent="var(--amber)"
          joined={!!room.p2_name}
          name={room.p2_name}
        />
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <span className="eyebrow">Spectator link</span>
        <div className="row-wrap" style={{ marginTop: 12 }}>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--fg-dim)' }}>
            {viewUrl}
          </code>
          <button
            className="btn ghost"
            onClick={() => navigator.clipboard?.writeText(viewUrl)}
          >
            Copy
          </button>
        </div>
      </div>

      <div className="row-wrap" style={{ marginTop: 32 }}>
        <button
          className="btn huge"
          disabled={room.status !== 'ready'}
          onClick={async () => {
            try { await api(`/api/h2h/${room.id}/start`, { method: 'POST', body: '{}' }); } catch {}
          }}
        >
          {room.status === 'ready' ? 'Start the race' : 'Waiting for both players…'}
        </button>
        <Link className="btn ghost" href="/head-to-head">Back to Head-to-Head</Link>
      </div>
    </div>
  );
}

function UrlCard({
  label, url, accent, joined, name,
}: { label: string; url: string; accent: string; joined: boolean; name: string | null }) {
  return (
    <div className="card schema" style={{ borderTop: `2px solid ${accent}` }}>
      <span className="eyebrow" style={{ color: accent }}>{label}</span>
      <div
        style={{
          marginTop: 12,
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 700,
          color: joined ? 'var(--fg)' : 'var(--muted)',
        }}
      >
        {joined ? name : 'Waiting to join…'}
      </div>
      <div className="row-wrap" style={{ marginTop: 18 }}>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-dim)' }}>
          {url}
        </code>
        <button
          className="btn ghost"
          onClick={() => navigator.clipboard?.writeText(url)}
        >
          Copy link
        </button>
      </div>
    </div>
  );
}

function LiveView({ room, passageText }: { room: any; passageText: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(iv);
  }, []);

  const startsAt = room.starts_at ? new Date(room.starts_at).getTime() : 0;
  const endsAt = room.ends_at ? new Date(room.ends_at).getTime() : 0;
  const inCountdown = now < startsAt;
  const countdownN = Math.ceil((startsAt - now) / 1000);
  const remainingS = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const timerClass = remainingS <= 5 ? 'timer err' : remainingS <= 15 ? 'timer warn' : 'timer';

  // Nudge server to finalize once the deadline passes.
  useEffect(() => {
    if (inCountdown) return;
    if (endsAt && now > endsAt + 500) {
      fetch(`/api/h2h/${room.id}/finalize`, { method: 'POST' }).catch(() => {});
    }
  }, [now, endsAt, inCountdown, room.id]);

  if (inCountdown) {
    return (
      <div className="full-stage center">
        <div className="h2">Get ready…</div>
        <div className="countdown">{countdownN > 0 ? countdownN : 'GO!'}</div>
        <div className="h3">{room.p1_name} vs. {room.p2_name}</div>
      </div>
    );
  }

  return (
    <div className="full-stage">
      <div className="row">
        <span className="eyebrow amber">Live · Room {room.id}</span>
        <div className="spacer" />
        <div className={timerClass}>{remainingS}s</div>
      </div>
      <div className="lanes" style={{ marginTop: 18 }}>
        <LiveLane lane="1" name={room.p1_name} typed={room.p1_typed || ''} passage={passageText} accent="var(--cyan)" />
        <LiveLane lane="2" name={room.p2_name} typed={room.p2_typed || ''} passage={passageText} accent="var(--amber)" />
      </div>
    </div>
  );
}

function LiveLane({
  lane, name, typed, passage, accent,
}: { lane: string; name: string | null; typed: string; passage: string; accent: string }) {
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
  const progress = passage.length > 0 ? Math.min(100, Math.round((typed.length / passage.length) * 100)) : 0;

  return (
    <div className="lane" style={{ borderTop: `2px solid ${accent}` }}>
      <div className="row">
        <div className="h2" style={{ color: accent }}>Player {lane}</div>
        <div className="spacer" />
        <span className="pill">{progress}%</span>
      </div>
      <div className="h3" style={{ margin: '6px 0 14px' }}>{name || 'Unknown'}</div>
      <div className="passage">
        {chars.map((c, i) => (
          <span key={i} className={'ch ' + c.cls}>{c.ch === '\n' ? '\n' : c.ch}</span>
        ))}
      </div>
    </div>
  );
}

function Results({ room }: { room: any }) {
  const winner = room.winner === '1' ? room.p1_name : room.winner === '2' ? room.p2_name : 'Tie';
  return (
    <div className="full-stage">
      <div className="winner-banner reveal">
        Winner: {winner}
      </div>

      <div className="grid2">
        <ResultCard
          label="Player 1"
          name={room.p1_name}
          score={room.p1_score}
          wpm={room.p1_wpm}
          acc={room.p1_acc}
          winner={room.winner === '1'}
          accent="var(--cyan)"
        />
        <ResultCard
          label="Player 2"
          name={room.p2_name}
          score={room.p2_score}
          wpm={room.p2_wpm}
          acc={room.p2_acc}
          winner={room.winner === '2'}
          accent="var(--amber)"
        />
      </div>

      <div className="row-wrap" style={{ marginTop: 32, justifyContent: 'center' }}>
        <Link className="btn" href="/head-to-head">Back to Head-to-Head</Link>
      </div>
    </div>
  );
}

function ResultCard({
  label, name, score, wpm, acc, winner, accent,
}: { label: string; name: string | null; score: any; wpm: any; acc: any; winner: boolean; accent: string }) {
  return (
    <div
      className={'card schema ' + (winner ? 'winner-card' : '')}
      style={{
        borderTop: `2px solid ${accent}`,
        outline: winner ? '2px solid var(--ok)' : undefined,
        outlineOffset: winner ? '2px' : undefined,
      }}
    >
      <span className="eyebrow" style={{ color: accent }}>{label}</span>
      <div style={{ marginTop: 10, fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700 }}>
        {name || '—'}
      </div>
      <div className="grid2" style={{ marginTop: 18 }}>
        <div className="tile"><div className="lbl">WPM</div><div className="big">{wpm ?? '—'}</div></div>
        <div className="tile"><div className="lbl">Accuracy</div><div className="big">{acc ?? '—'}%</div></div>
        <div className="tile" style={{ gridColumn: '1 / span 2' }}>
          <div className="lbl">Overall Score</div>
          <div className="big" style={{ color: winner ? 'var(--ok)' : 'var(--fg)' }}>{score ?? '—'}</div>
        </div>
      </div>
    </div>
  );
}
