'use client';
import { useAppState } from '@/components/useAppState';

export default function ResultsPage() {
  const { state } = useAppState();
  const live = state?.live as any;
  if (!live || live.kind !== 'race' || live.status !== 'done') {
    return (
      <div className="full-stage center">
        <div className="h1">No recent results</div>
        <div className="h3">Finish a race to see results here.</div>
      </div>
    );
  }
  const r1 = {
    name: live.p1Name,
    score: live.p1_score,
    wpm: live.p1_wpm,
    acc: live.p1_acc,
    errors: live.p1_errors,
    playerId: live.p1_id,
  };
  const r2 = {
    name: live.p2Name,
    score: live.p2_score,
    wpm: live.p2_wpm,
    acc: live.p2_acc,
    errors: live.p2_errors,
    playerId: live.p2_id,
  };
  const winnerName =
    live.winner_id === r1.playerId ? r1.name : live.winner_id === r2.playerId ? r2.name : 'Tie';
  return (
    <div className="full-stage">
      <div className="winner-banner">Winner: {winnerName}</div>
      <div className="grid2">
        <Card title="Player 1" data={r1} accent="var(--p1)" />
        <Card title="Player 2" data={r2} accent="var(--p2)" />
      </div>
    </div>
  );
}

function Card({ title, data, accent }: any) {
  return (
    <div className="card" style={{ borderColor: accent }}>
      <div className="h2" style={{ color: accent }}>{title} — {data.name}</div>
      <div className="grid2">
        <Tile lbl="WPM" big={data.wpm} />
        <Tile lbl="Accuracy" big={`${data.acc}%`} />
        <Tile lbl="Score" big={data.score} />
        <Tile lbl="Errors" big={
          data.errors
            ? Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join(' · ')
            : '—'
        } />
      </div>
    </div>
  );
}
function Tile({ lbl, big }: any) {
  return (
    <div className="tile">
      <div className="lbl">{lbl}</div>
      <div className="big" style={{ fontSize: String(big).length > 20 ? 22 : 56 }}>{big}</div>
    </div>
  );
}
