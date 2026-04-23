'use client';
import { useState } from 'react';
import { api, getAdminToken, setAdminToken } from '@/components/api';
import { useAppState } from '@/components/useAppState';

export default function AdminPage() {
  const { state } = useAppState();
  const [p1Name, setP1Name] = useState('');
  const [p1Company, setP1Company] = useState('');
  const [p2Name, setP2Name] = useState('');
  const [p2Company, setP2Company] = useState('');
  const [duration, setDuration] = useState(60);
  const [passageId, setPassageId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [token, setToken] = useState('');

  // Lazily hydrate token from localStorage on first render.
  if (typeof window !== 'undefined' && token === '' && getAdminToken()) {
    setTimeout(() => setToken(getAdminToken()), 0);
  }

  function saveToken() {
    setAdminToken(token);
    setErr(null);
  }

  async function startRace() {
    setErr(null);
    try {
      await api('/api/admin/race/start', {
        method: 'POST',
        body: JSON.stringify({
          p1: { name: p1Name, company: p1Company },
          p2: { name: p2Name, company: p2Company },
          durationS: duration,
          passageId: passageId || undefined,
        }),
      });
      setP1Name(''); setP1Company(''); setP2Name(''); setP2Company('');
    } catch (e: any) { setErr(e.message); }
  }
  async function abort() {
    await api('/api/admin/race/abort', { method: 'POST', body: '{}' });
  }
  async function skipQueue(id: string) {
    await api(`/api/admin/queue/${id}/skip`, { method: 'POST', body: '{}' });
  }
  async function markQueueDone(id: string) {
    await api(`/api/admin/queue/${id}/done`, { method: 'POST', body: '{}' });
  }
  async function lockFinal() {
    setErr(null);
    try { await api('/api/admin/final/lock', { method: 'POST', body: '{}' }); }
    catch (e: any) { setErr(e.message); }
  }
  async function startNextFinal() {
    const f = state?.final;
    if (!f) return;
    try { await api(`/api/admin/final/${f.id}/start-next`, { method: 'POST', body: '{}' }); }
    catch (e: any) { setErr(e.message); }
  }
  async function resetEvent() {
    await api('/api/admin/event/reset', { method: 'POST', body: '{}' });
    setConfirmReset(false);
  }
  async function exportCsv() {
    const r = await api<{ csv: string }>('/api/admin/export');
    try { await navigator.clipboard.writeText(r.csv); } catch {}
    alert('Copied CSV to clipboard.\n\n' + r.csv.slice(0, 400) + (r.csv.length > 400 ? '\n…' : ''));
  }
  async function startCeoFinal() {
    const ids = window.prompt(
      'Enter player IDs for CEO final, comma-separated. (Get IDs from the Top-5 card below or /api/state.)'
    );
    if (!ids) return;
    const playerIds = ids.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      await api('/api/admin/final/ceo-lock', {
        method: 'POST', body: JSON.stringify({ playerIds }),
      });
    } catch (e: any) { setErr(e.message); }
  }

  if (!state) return <div className="h2">Loading…</div>;
  const live = state.live as any;
  const queue = state.queue.filter((q) => q.status === 'waiting');
  const liveActive = live && (live.kind === 'race' ? live.status !== 'done' && live.status !== 'aborted' : live.current_status === 'pending');

  return (
    <div>
      <div className="h1">Admin</div>
      {err && <div className="pill err" style={{ marginBottom: 10 }}>{err}</div>}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="h3" style={{ marginBottom: 6 }}>Admin token</div>
        <div className="row-wrap">
          <input
            type="text"
            placeholder="paste ADMIN_TOKEN (stored in this browser only)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ maxWidth: 520 }}
          />
          <button className="btn" onClick={saveToken}>Save</button>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="h2">Start a race</div>
          <div className="grid2">
            <div>
              <label>P1 name</label>
              <input type="text" value={p1Name} onChange={(e) => setP1Name(e.target.value)} />
              <label>P1 company</label>
              <input type="text" value={p1Company} onChange={(e) => setP1Company(e.target.value)} />
            </div>
            <div>
              <label>P2 name</label>
              <input type="text" value={p2Name} onChange={(e) => setP2Name(e.target.value)} />
              <label>P2 company</label>
              <input type="text" value={p2Company} onChange={(e) => setP2Company(e.target.value)} />
            </div>
          </div>
          <div className="row-wrap" style={{ marginTop: 12 }}>
            <label>Duration</label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={60}>60s</option>
              <option value={90}>90s</option>
              <option value={120}>120s</option>
            </select>
            <label>Passage</label>
            <select value={passageId} onChange={(e) => setPassageId(e.target.value)}>
              <option value="">random</option>
              {state.passages.map((p) => (
                <option key={p.id} value={p.id}>{p.id} ({p.kind})</option>
              ))}
            </select>
          </div>
          <div style={{ height: 14 }} />
          <button
            className="btn big"
            disabled={!p1Name.trim() || !p2Name.trim() || !!liveActive}
            onClick={startRace}
          >
            Start race
          </button>
          <div className="row-wrap" style={{ marginTop: 12 }}>
            <button className="btn warn" disabled={!liveActive} onClick={abort}>Abort current</button>
          </div>
        </div>

        <div className="card">
          <div className="h2">Live</div>
          {!live && <div className="h3">Nothing live.</div>}
          {live && (
            <div>
              <div className="row-wrap">
                <span className="pill">{live.kind}</span>
                <span className="pill">{live.kind === 'race' ? live.status : live.current_status || 'idle'}</span>
                <span className="pill">{live.passage_id}</span>
                <span className="pill">duration {live.duration_s}s</span>
              </div>
              <div style={{ marginTop: 10 }}>
                {live.kind === 'race' ? (
                  <>
                    <div><b>P1:</b> {live.p1Name} {live.p1_submitted_at ? 'submitted' : ''}</div>
                    <div><b>P2:</b> {live.p2Name} {live.p2_submitted_at ? 'submitted' : ''}</div>
                  </>
                ) : (
                  <div><b>Finalist:</b> {live.playerName}</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="h2">Queue</div>
          {queue.length === 0 && <div className="h3">Queue is empty.</div>}
          {queue.map((q) => (
            <div key={q.id} className="row-wrap" style={{ borderBottom: '1px solid #2a2a33', padding: '8px 0' }}>
              <div style={{ minWidth: 60 }}>#{q.position}</div>
              <div style={{ minWidth: 260 }}><b>{q.name}</b> {q.company ? `— ${q.company}` : ''}</div>
              <button className="btn ghost" onClick={() => { setP1Name(q.name); setP1Company(q.company || ''); }}>Use as P1</button>
              <button className="btn ghost" onClick={() => { setP2Name(q.name); setP2Company(q.company || ''); }}>Use as P2</button>
              <button className="btn warn" onClick={() => skipQueue(q.id)}>Skip</button>
              <button className="btn ok" onClick={() => markQueueDone(q.id)}>Done</button>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="h2">Top 5</div>
          <ol style={{ fontSize: 24 }}>
            {state.top5.map((r) => (
              <li key={r.player_id}>
                <b>{r.name}</b> {r.company ? `— ${r.company}` : ''} · score {r.best_score} · acc {r.best_acc}%
                <span className="pill" style={{ marginLeft: 8, fontSize: 12 }}>{r.player_id}</span>
              </li>
            ))}
          </ol>
          <div className="row-wrap">
            <button className="btn" onClick={lockFinal} disabled={state.top5.length < 2}>Lock top-5 final</button>
            <button className="btn ghost" onClick={startCeoFinal}>+ CEO bonus round</button>
          </div>
          {state.final && (
            <div style={{ marginTop: 12 }}>
              <div className="h3">
                Final state: {state.final.state} · run {state.final.current_index}/{state.final.order_json.length}
              </div>
              <button
                className="btn big"
                disabled={state.final.state === 'done' || !!liveActive}
                onClick={startNextFinal}
              >
                Start next finalist
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="h2">Event</div>
          <div className="row-wrap">
            <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
            {!confirmReset ? (
              <button className="btn err" onClick={() => setConfirmReset(true)}>Reset event day</button>
            ) : (
              <>
                <span className="pill warn">Sure? Archives current day.</span>
                <button className="btn err" onClick={resetEvent}>Yes, reset</button>
                <button className="btn ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
