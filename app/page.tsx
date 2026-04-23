'use client';
import Link from 'next/link';
import { useAppState } from '@/components/useAppState';

export default function Home() {
  const { state } = useAppState();
  const rows = (state?.leaderboard || []).slice(0, 10);

  return (
    <section className="hero">
      <div className="hero__copy fade-in">
        <span className="eyebrow amber">Braintrust · Typing Competition</span>

        <h1 className="h1" style={{ marginTop: 20 }}>
          Type fast.
          <br />Type <span style={{ color: 'var(--amber)' }}>clean.</span>
          <br />Top the leaderboard.
        </h1>

        <p className="h3" style={{ marginTop: 22, maxWidth: 540 }}>
          Get 30 seconds to test your WPM and accuracy. See if you can top the
          leaderboard.
        </p>

        <div className="row-wrap" style={{ marginTop: 36 }}>
          <Link href="/play" className="btn huge">
            Play Now
          </Link>
        </div>
      </div>

      <aside className="hero__panel fade-in delay-2">
        <div className="card hero-panel schema">
          <div className="row" style={{ alignItems: 'baseline' }}>
            <span className="eyebrow">Leaderboard · Top 10</span>
            <div className="spacer" />
            <Link
              href="/leaderboard"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
              }}
            >
              View all →
            </Link>
          </div>

          <div style={{ marginTop: 18 }}>
            <table className="lb lb-compact">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Name</th>
                  <th style={{ textAlign: 'right' }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="center h3" style={{ padding: 24 }}>
                      No scores yet — be the first.
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => {
                  const rank = i + 1;
                  const cls = [
                    rank <= 5 ? 'top' : '',
                    rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <tr key={r.player_id} className={cls}>
                      <td>
                        <span className="rank" style={{ width: 34 }}>
                          #{rank}
                        </span>
                      </td>
                      <td>{r.name}</td>
                      <td style={{ textAlign: 'right' }}>{r.best_score}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </aside>

      {/* Local styles co-located with the asymmetric hero. */}
      <style jsx>{`
        .hero {
          display: grid;
          grid-template-columns: 1.25fr 1fr;
          gap: 56px;
          align-items: start;
          padding: clamp(32px, 6vw, 96px) 0 48px;
          position: relative;
        }
        .hero::before {
          content: '';
          position: absolute;
          width: 520px;
          height: 520px;
          top: -120px;
          left: -220px;
          background: radial-gradient(closest-side, rgba(246, 182, 106, 0.1), transparent 70%);
          pointer-events: none;
        }
        .hero__copy { position: relative; z-index: 1; }
        .hero__panel { display: flex; flex-direction: column; gap: 20px; }
        @media (max-width: 900px) {
          .hero { grid-template-columns: 1fr; gap: 32px; }
        }
      `}</style>
      <style jsx global>{`
        /* Tighter leaderboard for the homepage side panel. */
        table.lb.lb-compact th { padding: 10px 12px; font-size: 10px; }
        table.lb.lb-compact td { padding: 10px 12px; font-size: 14px; }
      `}</style>
    </section>
  );
}
