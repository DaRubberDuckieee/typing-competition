'use client';
import { useState } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/useAppState';

export default function SignupPage() {
  const { state } = useAppState();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setMsg(null);
    try {
      const r = await api<{ queue: { position: number } }>('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ name, title, company }),
      });
      setMsg(`You're in! Queue position #${r.queue.position}. Watch the monitor — we'll call you up.`);
      setName(''); setTitle(''); setCompany('');
    } catch (e: any) { setErr(e.message || 'something went wrong'); }
  }

  return (
    <div
      className="full-stage"
      style={{
        alignItems: 'center',
        textAlign: 'center',
        paddingTop: 'clamp(48px, 10vh, 120px)',
      }}
    >
      <span className="eyebrow amber">Head-to-head</span>
      <h1 className="h1" style={{ marginTop: 14 }}>Reserve a slot</h1>
      <p className="h3" style={{ maxWidth: 540, marginTop: 20 }}>
        Fill out your details. You can also walk up to a staff member.
      </p>

      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 560,
          marginTop: 56,
          textAlign: 'left',
        }}
      >
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jess Wang" />
        <label>Title</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Software Engineer" />
        <label>Company</label>
        <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Braintrust" />
        <div style={{ height: 20 }} />
        <button className="btn big" disabled={!name.trim()} onClick={submit}>
          Reserve my slot
        </button>
        {msg && <div style={{ marginTop: 18 }}><span className="pill ok">{msg}</span></div>}
        {err && <div style={{ marginTop: 18 }}><span className="pill err">{err}</span></div>}
      </div>

      {state && state.queue.length > 0 && (
        <div
          className="card"
          style={{ width: '100%', maxWidth: 560, marginTop: 28, textAlign: 'left' }}
        >
          <span className="eyebrow">Current queue</span>
          <ol style={{ marginTop: 14, paddingLeft: 20, fontSize: 16, color: 'var(--fg-dim)' }}>
            {state.queue.filter((q) => q.status === 'waiting').map((q) => (
              <li key={q.id} style={{ padding: '6px 0' }}>
                <b>{q.name}</b> {q.company ? `— ${q.company}` : ''}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
