'use client';
import { useAppState } from '@/components/useAppState';

export default function FinalPage() {
  const { state } = useAppState();
  if (!state) return <div className="h2">Loading…</div>;
  const f = state.final;
  const live = state.live as any;

  if (!f) {
    return (
      <div className="full-stage center">
        <div className="h1">Final round not started</div>
        <div className="h3">Ask staff to lock the top-5 qualifiers from the Admin panel.</div>
      </div>
    );
  }
  const completed = f.players.filter((p: any) => p.run).sort((a: any, b: any) => b.run.score - a.run.score);
  const pending = f.players.filter((p: any) => !p.run);
  const done = f.state === 'done' && completed.length > 0;

  return (
    <div className="full-stage">
      <span className="eyebrow amber">Final round</span>
      <div className="h1" style={{ marginTop: 14 }}>Championship</div>
      <div className="h3" style={{ marginTop: 10 }}>Passage: {f.passage_id} · duration {f.duration_s}s · run {f.current_index}/{f.order_json.length}</div>

      {done && (
        <div className="winner-banner" style={{ marginTop: 24 }}>
          Winner: {completed[0].name} — score {completed[0].run.score}
        </div>
      )}

      {live?.kind === 'final' && live?.current_status === 'pending' && (
        <div className="card" style={{ marginTop: 14, borderColor: 'var(--cyan)' }}>
          <div className="h2">On deck: {live.playerName}</div>
          <div className="h3">Watching lane 1.</div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <table className="lb">
          <thead>
            <tr>
              <th>Rank</th><th>Name</th><th>Company</th>
              <th style={{ textAlign: 'right' }}>Score</th>
              <th style={{ textAlign: 'right' }}>WPM</th>
              <th style={{ textAlign: 'right' }}>Acc</th>
            </tr>
          </thead>
          <tbody>
            {completed.map((p: any, i: number) => (
              <tr key={p.id} className={i === 0 ? 'top gold' : 'top'}>
                <td><span className="rank">#{i + 1}</span></td>
                <td>{p.name}</td>
                <td>{p.company}</td>
                <td style={{ textAlign: 'right' }}>{p.run.score}</td>
                <td style={{ textAlign: 'right' }}>{p.run.wpm}</td>
                <td style={{ textAlign: 'right' }}>{p.run.acc}%</td>
              </tr>
            ))}
            {pending.map((p: any) => (
              <tr key={p.id}>
                <td><span className="rank">—</span></td>
                <td>{p.name}</td>
                <td>{p.company}</td>
                <td style={{ textAlign: 'right', color: 'var(--muted)' }}>pending</td>
                <td /><td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
