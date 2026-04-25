# External Integrations
_Last updated: 2026-04-25_

## Summary

Supabase is the only external service this project integrates with. It provides PostgreSQL storage and Realtime change-feed subscriptions. Vercel is the deployment platform. There are no payment processors, email services, auth providers, CDNs, analytics tools, error trackers, or feature flag systems wired in.

## APIs & External Services

**Database + Realtime:**
- Supabase — PostgreSQL database (via PostgREST REST API) + Realtime websocket subscriptions
  - SDK/Client: `@supabase/supabase-js` v2.104.0
  - Two clients are instantiated in `lib/supabase.ts`:
    - **Browser client** (`supabaseBrowser()`): uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`, singleton, configured with `realtime: { params: { eventsPerSecond: 10 } }`, used for Realtime subscriptions from client components
    - **Server client** (`supabaseServer()`): uses `SUPABASE_SERVICE_ROLE_KEY`, singleton, `auth.persistSession: false` + `autoRefreshToken: false`, used exclusively in API route handlers and `lib/state.ts`

## Data Storage

**Database:**
- Supabase (hosted PostgreSQL)
  - Connection env var: `NEXT_PUBLIC_SUPABASE_URL`
  - Client: `@supabase/supabase-js` (PostgREST, not direct pg connection)
  - Schema defined in `supabase/schema.sql` — applied manually via Supabase SQL editor
  - Tables: `event`, `players`, `queue`, `races`, `final`, `final_runs`, `solo_runs`, `h2h_rooms`
  - RLS enabled on all tables; public `SELECT` allowed via policies; all writes use service role (bypasses RLS)
  - `pgcrypto` extension enabled

**File Storage:**
- None — no Supabase Storage, no S3, no local file uploads

**Caching:**
- None — no Redis, no in-memory cache, no Next.js `cache()` usage. All reads go to Supabase. Leaderboard aggregation is computed in-memory on each request (`lib/state.ts`).

## Authentication & Identity

**Auth Provider:**
- Custom token — not Supabase Auth, not NextAuth, not Clerk
- Admin endpoints are guarded by a shared secret (`ADMIN_TOKEN` env var) sent as `X-Admin-Token` header or `?token=` query param (see `lib/auth.ts`)
- If `ADMIN_TOKEN` is unset, all admin routes are open (intentional dev convenience)
- No user accounts, no sessions, no JWT — players are identified by a short `nanoid(10)` stored in localStorage by the client

## Realtime Subscriptions

**Implementation:** Supabase Postgres change feeds via the `supabase_realtime` publication

**Tables subscribed to (browser):**
- `races`, `final`, `final_runs`, `queue`, `players`, `event` — subscribed in `components/useAppState.ts` via a single channel named `typing-race`
- `h2h_rooms` (filtered to a specific room id) — subscribed in `components/useRoom.ts` via a channel named `h2h-{id}`

**Strategy:** On any DB change, a debounced refetch of `/api/state` (or `/api/h2h/[id]`) is triggered (120ms debounce for app state, 100ms for rooms). A 10s polling interval backs up Realtime in case the websocket drops.

## Monitoring & Observability

**Error Tracking:**
- None — no Sentry, no Datadog, no LogRocket

**Logs:**
- `console.error(...)` used in a few places in `lib/state.ts` (e.g., solo submit failures, solo finalize failures). No structured logging. Logs surface in Vercel function logs only.

## CI/CD & Deployment

**Hosting:**
- Vercel — `.vercel/project.json` confirms project `typing-competition` under org `team_b9kUz20wNL0Og6Z1X7DNZO7H`
- Serverless model: every API route is a stateless Vercel function invocation. `lib/state.ts` design note explicitly calls this out: "no in-memory state on the server, which makes Vercel's serverless model fine."

**CI Pipeline:**
- None detected — no GitHub Actions, no CircleCI, no Vercel build checks beyond the default Vercel deploy pipeline

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None — no webhooks sent from this app to external services

## Environment Configuration

**Required env vars (from `.env.example`):**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (e.g., `https://abcd1234.supabase.co`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase public/anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (server-only, never sent to browser)
- `ADMIN_TOKEN` — shared secret for staff-facing admin endpoints (optional; if absent, admin is open)

**Secrets location:**
- Local: `.env.local` (gitignored)
- Production: Vercel environment variables dashboard

## Open Questions

- No health-check endpoint exists — Vercel has no way to detect Supabase outages before serving broken pages.
- The Supabase singleton pattern (`let _browser: SupabaseClient | null = null`) could be stale across hot-reloads in dev; this is a known Next.js dev-mode edge case.
- No rate limiting on API routes — admin and player endpoints are unprotected beyond the `ADMIN_TOKEN` check.
