'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/components/api';

// /head-to-head is the hub for head-to-head content:
//   - Big countdown to the next 8pm showdown
//   - Primary CTA: Start an instant 1v1 with a friend
//   - Secondary: Reserve a slot for the scheduled showdown
export default function HeadToHeadPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startInstant() {
    setCreating(true); setErr(null);
    try {
      const r = await api<{ room: { id: string } }>('/api/h2h/create', {
        method: 'POST',
        body: JSON.stringify({ durationS: 60 }),
      });
      router.push(`/h2h/${r.room.id}`);
    } catch (e: any) {
      setErr(e.message || 'could not create room');
      setCreating(false);
    }
  }

  return (
    <section>
      <span className="eyebrow amber">Head-to-Head</span>
      <h1 className="h1" style={{ marginTop: 14 }}>
        The big <span style={{ color: 'var(--amber)' }}>showdown</span> starts at 8:00 PM.
      </h1>
      <p className="h3" style={{ marginTop: 18, maxWidth: 620 }}>
        Type against someone live. Reserve a slot for the scheduled bracket, or
        spin up an instant 1v1 with three shared links and race right now.
      </p>

      <div className="card hero-panel schema" style={{ marginTop: 40 }}>
        <span className="eyebrow">Countdown to showdown</span>
        <Countdown8pm />
      </div>

      <div className="grid2" style={{ marginTop: 24 }}>
        <div className="card schema">
          <span className="eyebrow amber">Instant 1v1</span>
          <h2 className="h2" style={{ marginTop: 10 }}>Race a friend now</h2>
          <p className="h3" style={{ marginTop: 10 }}>
            Create a room, get three links (Player 1, Player 2, spectator), and
            send them out. 60 seconds, live scoreboard, winner revealed.
          </p>
          <div className="row-wrap" style={{ marginTop: 22 }}>
            <button className="btn big" disabled={creating} onClick={startInstant}>
              {creating ? 'Creating…' : 'Start a 1v1'}
            </button>
            {err && <span className="pill err">{err}</span>}
          </div>
        </div>

        <div className="card schema">
          <span className="eyebrow">Scheduled showdown</span>
          <h2 className="h2" style={{ marginTop: 10 }}>Reserve a slot</h2>
          <p className="h3" style={{ marginTop: 10 }}>
            Drop your name in the queue and we'll call you up when it's your
            turn at the main stage.
          </p>
          <div className="row-wrap" style={{ marginTop: 22 }}>
            <Link className="btn big ghost" href="/signup">
              Reserve a slot
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Live countdown to the next occurrence of 8:00 PM local time. */
function Countdown8pm() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, []);

  if (now == null) {
    return <div style={{ marginTop: 20, height: 160 }} />;
  }

  const target = next8pm();
  let remaining = Math.max(0, Math.floor((target.getTime() - now) / 1000));
  const days = Math.floor(remaining / 86400); remaining -= days * 86400;
  const hours = Math.floor(remaining / 3600); remaining -= hours * 3600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div>
      <div
        style={{
          marginTop: 18,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 14,
        }}
      >
        <TimeBlock label="Days" value={days} />
        <TimeBlock label="Hours" value={hours} />
        <TimeBlock label="Minutes" value={minutes} />
        <TimeBlock label="Seconds" value={seconds} accent />
      </div>
      <div className="h3" style={{ marginTop: 20 }}>
        Target: {target.toLocaleString(undefined, {
          weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })}
      </div>
    </div>
  );
}

function TimeBlock({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      style={{
        background: 'var(--panel-2)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '22px 18px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 'clamp(2.5rem, 5vw, 4rem)',
          color: accent ? 'var(--amber)' : 'var(--fg)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {String(value).padStart(2, '0')}
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function next8pm(): Date {
  const now = new Date();
  const target = new Date(now);
  target.setHours(20, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}
