'use client';
import { useAppState } from '@/components/useAppState';

export default function LeaderboardPage() {
  const { state } = useAppState();
  if (!state) return <div className="h2">Loading…</div>;
  const rows = state.leaderboard.slice(0, 20);
  return (
    <div className="full-stage">
      <span className="eyebrow amber">Standings</span>
      <div className="h1" style={{ marginTop: 14, marginBottom: 28 }}>Leaderboard</div>
      <div className="card">
        <table className="lb">
          <thead>
            <tr>
              <th>Rank</th><th>Name</th><th>Company</th>
              <th style={{ textAlign: 'right' }}>Score</th>
              <th style={{ textAlign: 'right' }}>Acc</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="center h3">No scores yet — be the first!</td></tr>
            )}
            {rows.map((r, i) => {
              const rank = i + 1;
              const cls = [
                rank <= 5 ? 'top' : '',
                rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '',
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
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
