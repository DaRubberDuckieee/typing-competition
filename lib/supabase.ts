// Two Supabase clients.
// - Browser: uses the anon key. Public SELECT via RLS policies + Realtime subs.
// - Server: uses the service_role key. Bypasses RLS for all writes. Must never be shipped to the browser.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let _browser: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient {
  if (!_browser) {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }
    _browser = createClient(SUPABASE_URL, SUPABASE_ANON, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return _browser;
}

let _server: SupabaseClient | null = null;
export function supabaseServer(): SupabaseClient {
  if (!_server) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    }
    _server = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _server;
}
