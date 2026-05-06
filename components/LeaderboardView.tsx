'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type LBRow = {
  player_id: string;
  name: string;
  title: string | null;
  company: string | null;
  best_score: number;
  best_acc: number;
  best_at: string;
};

type EventLBRow = {
  player_id: string;
  name: string;
  title: string | null;
  company: string | null;
  score: number;
  wpm: number;
  acc: number;
  ended_at: string | null;
};

// 'today' / 'all' = qualifying leaderboard (booth + solo). 'event' = the
// per-day Final Event leaderboard (only is_event_run=true rows).
type Scope = 'today' | 'all' | 'event';

export type LeaderboardViewProps = {
  // When set, that row pulses and is labeled with its rank ("You placed #N").
  // Used by the post-race transition on the booth lane page.
  highlightedPlayerId?: string | null;
  // Optional override for what the Play-now buttons do. By default they route
  // to /booth/1 and /booth/2 directly. The booth lane page passes a callback
  // that resets local state instead of doing a full navigation.
  onPlayNow?: (lane: '1' | '2') => void;
  // Whether to show the wordmark heading. Off when embedded under another
  // heading (e.g. the result-flash auto-transition).
  showHeader?: boolean;
  // When set, render only one Play-now button for that lane. Used by the
  // booth page's post-race leaderboard so the just-finished player only sees
  // the button for their own laptop's lane.
  lockToLane?: '1' | '2';
  // Landing-page mode picker: solo is the primary booth flow, while 1v1 stays
  // reachable through the existing lane URLs.
  showModePicker?: boolean;
  // Post-run solo booth CTA. Sends players back to the landing mode picker.
  showRestartCta?: boolean;
};

// Reusable leaderboard. Renders a Today/All-days tab strip, the top-20 table,
// and Play now buttons for both lanes. Polls /api/leaderboard every 5 seconds
// so it stays current while the booth is idle.
export function LeaderboardView({
  highlightedPlayerId,
  onPlayNow,
  showHeader = true,
  lockToLane,
  showModePicker = false,
  showRestartCta = false,
}: LeaderboardViewProps) {
  const [scope, setScope] = useState<Scope>('today');
  const [rows, setRows] = useState<LBRow[]>([]);
  // Event-mode state lives separately so switching tabs doesn't blow away
  // the qualifying leaderboard. `eventDay` is the historical day picker
  // inside the Day Finals tab (defaults to 'today' — i.e. the latest day
  // returned by the API).
  const [eventRows, setEventRows] = useState<EventLBRow[]>([]);
  const [eventDays, setEventDays] = useState<string[]>([]);
  const [eventDay, setEventDay] = useState<string | null>(null);

  const load = useCallback(async (s: Scope) => {
    if (s === 'event') return; // handled by loadEvent below
    try {
      const limit = highlightedPlayerId ? 1000 : 20;
      const r = await fetch(`/api/leaderboard?scope=${s}&limit=${limit}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch {}
  }, [highlightedPlayerId]);

  const loadEvent = useCallback(async (day: string | null) => {
    try {
      const url = day
        ? `/api/event/leaderboard?day=${encodeURIComponent(day)}`
        : '/api/event/leaderboard';
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      setEventRows(Array.isArray(j.rows) ? j.rows : []);
      setEventDays(Array.isArray(j.days) ? j.days : []);
    } catch {}
  }, []);

  useEffect(() => {
    if (scope === 'event') {
      loadEvent(eventDay);
      const iv = setInterval(() => loadEvent(eventDay), 5000);
      return () => clearInterval(iv);
    }
    load(scope);
    const iv = setInterval(() => load(scope), 5000);
    return () => clearInterval(iv);
  }, [scope, eventDay, load, loadEvent]);

  const myRank = highlightedPlayerId
    ? (scope === 'event'
        ? eventRows.findIndex((r) => r.player_id === highlightedPlayerId) + 1
        : rows.findIndex((r) => r.player_id === highlightedPlayerId) + 1)
    : 0;

  const qualifyingRows = useMemo(() => {
    const top = rows.slice(0, 20).map((row, i) => ({ row, rank: i + 1 }));
    if (highlightedPlayerId) {
      const idx = rows.findIndex((r) => r.player_id === highlightedPlayerId);
      if (idx >= 20) top.push({ row: rows[idx], rank: idx + 1 });
    }
    return top;
  }, [rows, highlightedPlayerId]);

  return (
    <section className="lb-view">
      {showHeader && (
        <header className="lb-view__head">
          <span className="eyebrow amber">Braintrust</span>
          <h1 className="h1" style={{ marginTop: 12, marginBottom: 12 }}>Typing Competition</h1>
        </header>
      )}

      {highlightedPlayerId && myRank > 0 && (
        <div className="lb-rank-badge">
          You placed <span className="lb-rank-num">#{myRank}</span> {scope === 'today' ? 'today' : 'all-time'}
        </div>
      )}

      {/* CTA pulled ABOVE the table so booth players never have to scroll
          to start a new race. */}
      <div className="lb-view__cta lb-view__cta--top row-wrap" style={{ justifyContent: 'center', marginTop: 12 }}>
        {showRestartCta ? (
          <Link className="btn huge" href="/">Restart</Link>
        ) : showModePicker && !lockToLane && !onPlayNow ? (
          <div className="lb-mode-picker">
            <Link className="btn huge lb-mode-primary" href="/booth/solo">Play solo</Link>
            <div className="lb-mode-group" aria-label="Race 1v1">
              <span className="lb-mode-eyebrow">Race 1v1</span>
              <div className="lb-mode-actions">
                <Link className="btn big ghost" href="/booth/1">Player 1</Link>
                <Link className="btn big ghost" href="/booth/2">Player 2</Link>
              </div>
            </div>
          </div>
        ) : lockToLane ? (
          onPlayNow ? (
            <button className="btn huge" onClick={() => onPlayNow(lockToLane)}>Play again</button>
          ) : (
            <Link className="btn huge" href={`/booth/${lockToLane}`}>Play again</Link>
          )
        ) : onPlayNow ? (
          <>
            <button className="btn huge" onClick={() => onPlayNow('1')}>Play as Player 1</button>
            <button className="btn huge" onClick={() => onPlayNow('2')}>Play as Player 2</button>
          </>
        ) : (
          <>
            <Link className="btn huge" href="/booth/1">Play as Player 1</Link>
            <Link className="btn huge" href="/booth/2">Play as Player 2</Link>
            <Link className="btn ghost" href="/event/play">Play solo event</Link>
          </>
        )}
      </div>

      <div className="lb-view__tabs">
        <button
          className={'lb-tab ' + (scope === 'today' ? 'active' : '')}
          onClick={() => setScope('today')}
        >
          Today
        </button>
        <button
          className={'lb-tab ' + (scope === 'all' ? 'active' : '')}
          onClick={() => setScope('all')}
        >
          All days
        </button>
        <button
          className={'lb-tab ' + (scope === 'event' ? 'active' : '')}
          onClick={() => setScope('event')}
        >
          Day finals
        </button>
      </div>

      {scope === 'event' && eventDays.length > 1 && (
        <div className="lb-view__day-picker">
          {eventDays.map((d) => (
            <button
              key={d}
              className={'lb-day ' + ((eventDay === d || (!eventDay && d === eventDays[0])) ? 'active' : '')}
              onClick={() => setEventDay(d)}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      <div className="card lb-view__table-card">
        <table className="lb">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Name</th>
              <th>Company</th>
              <th style={{ textAlign: 'right' }}>Score</th>
              <th style={{ textAlign: 'right' }}>Acc</th>
            </tr>
          </thead>
          <tbody>
            {scope === 'event' ? (
              eventRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="center h3" style={{ padding: 32 }}>
                    No final-event scores yet for this day.
                  </td>
                </tr>
              ) : (
                eventRows.map((r, i) => {
                  const rank = i + 1;
                  const isMe = highlightedPlayerId === r.player_id;
                  const cls = [
                    rank <= 5 ? 'top' : '',
                    rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '',
                    isMe ? 'lb-row-me' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <tr key={r.player_id} className={cls}>
                      <td><span className="rank">#{rank}</span></td>
                      <td>{r.name}</td>
                      <td>{r.company || ''}</td>
                      <td style={{ textAlign: 'right' }}>{r.score}</td>
                      <td style={{ textAlign: 'right' }}>{r.acc}%</td>
                    </tr>
                  );
                })
              )
            ) : qualifyingRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="center h3" style={{ padding: 32 }}>
                  No scores yet — be the first.
                </td>
              </tr>
            ) : (
              qualifyingRows.map(({ row: r, rank }) => {
                const isMe = highlightedPlayerId === r.player_id;
                const cls = [
                  rank <= 5 ? 'top' : '',
                  rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '',
                  isMe ? 'lb-row-me' : '',
                ].filter(Boolean).join(' ');
                return (
                  <tr key={r.player_id} className={cls}>
                    <td><span className="rank">#{rank}</span></td>
                    <td>{r.name}</td>
                    <td>{r.company || ''}</td>
                    <td style={{ textAlign: 'right' }}>{r.best_score}</td>
                    <td style={{ textAlign: 'right' }}>{r.best_acc}%</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>


      <style jsx>{`
        .lb-view { display: flex; flex-direction: column; gap: 18px; }
        .lb-view__head { text-align: center; }
        .lb-mode-picker {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          align-items: end;
          max-width: 980px;
        }
        .lb-mode-picker :global(.btn) { width: 100%; padding-inline: 20px; }
        .lb-mode-group {
          grid-column: span 2;
          position: relative;
        }
        .lb-mode-eyebrow {
          position: absolute;
          left: 14px;
          bottom: calc(100% + 8px);
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--muted);
          white-space: nowrap;
        }
        .lb-mode-eyebrow::before {
          content: '';
          width: 22px;
          height: 1px;
          background: var(--border-strong);
        }
        .lb-mode-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          padding: 6px;
          border: 1px solid var(--border);
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.025);
        }
        @media (max-width: 760px) {
          .lb-mode-picker { grid-template-columns: 1fr; }
          .lb-mode-group {
            grid-column: auto;
          }
          .lb-mode-actions { border-radius: 18px; }
          .lb-mode-eyebrow {
            left: 50%;
            transform: translateX(-50%);
          }
        }
        .lb-view__tabs { display: flex; gap: 10px; justify-content: center; margin-top: 6px; flex-wrap: wrap; }
        .lb-view__day-picker {
          display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
          margin-top: -6px;
        }
        .lb-day {
          font-family: var(--font-mono);
          font-size: 12px;
          padding: 6px 14px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--muted);
          border-radius: 6px;
          cursor: pointer;
        }
        .lb-day:hover { color: var(--fg); border-color: var(--border-strong); }
        .lb-day.active {
          color: var(--fg);
          background: rgba(246,182,106,0.12);
          border-color: var(--amber);
        }
        .lb-tab {
          font-family: var(--font-display);
          font-size: 13px; font-weight: 600;
          letter-spacing: 0.16em; text-transform: uppercase;
          padding: 10px 22px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--muted);
          border-radius: 9999px;
          cursor: pointer;
          transition: color 160ms ease, border-color 160ms ease, background 160ms ease;
        }
        .lb-tab:hover { color: var(--fg); border-color: var(--border-strong); }
        .lb-tab.active {
          color: var(--fg);
          background: rgba(255,255,255,0.04);
          border-color: var(--border-strong);
        }
        .lb-rank-badge {
          align-self: center;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(1.2rem, 2.5vw, 1.8rem);
          padding: 14px 28px;
          border-radius: 9999px;
          background: rgba(95, 168, 163, 0.18);
          border: 1px solid var(--ok);
          color: var(--ok);
          animation: rank-pulse 1.6s ease-in-out infinite;
        }
        .lb-rank-num {
          color: var(--fg);
          margin: 0 6px;
        }
        @keyframes rank-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(95, 168, 163, 0.45); }
          50%      { box-shadow: 0 0 0 18px rgba(95, 168, 163, 0); }
        }
      `}</style>
      <style jsx global>{`
        /* Pulsing highlight for the just-finished player's row. */
        tr.lb-row-me td {
          background: rgba(246, 182, 106, 0.08);
          color: var(--fg);
        }
        tr.lb-row-me {
          animation: lb-row-pulse 1.6s ease-in-out infinite;
        }
        @keyframes lb-row-pulse {
          0%, 100% { background: rgba(246, 182, 106, 0.06); }
          50%      { background: rgba(246, 182, 106, 0.18); }
        }
      `}</style>
    </section>
  );
}
