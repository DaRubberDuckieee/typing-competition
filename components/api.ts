'use client';
export function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('adminToken') || '';
}
export function setAdminToken(t: string) {
  if (typeof window === 'undefined') return;
  if (t) localStorage.setItem('adminToken', t);
  else localStorage.removeItem('adminToken');
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const isAdmin = path.startsWith('/api/admin');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as any),
  };
  if (isAdmin) {
    const tok = getAdminToken();
    if (tok) headers['X-Admin-Token'] = tok;
  }
  const r = await fetch(path, { ...init, headers, cache: 'no-store' });
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(json.error || r.statusText);
  return json;
}
