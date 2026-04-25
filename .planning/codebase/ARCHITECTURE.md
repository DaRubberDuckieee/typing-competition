# Braintrust Typing Race - Architecture
_Last updated: 2026-04-25_

## Summary

Typing Race is a real-time, head-to-head typing competition platform for live events. Built as a Next.js + Supabase application deployed to Vercel, with a focus on real-time state synchronization, deterministic scoring, and a stateless serverless architecture.

## Architectural Pattern

The system follows a **client-server model with event-driven real-time synchronization**:

- **Vercel Serverless API Routes** handle all state mutations (writes)
- **Supabase Postgres** stores durable state
- **Supabase Realtime** broadcasts changes to connected browsers
- **Browsers** subscribe to change feeds and re-fetch full state snapshots
- **Wall-clock timing** (no server-side timers) allows any invocation to serve any request

This design is inherently stateless: any Vercel function can handle any request because race timing is stored as absolute timestamps (`countdown_started_at`, `starts_at`, `ends_at`) in the database, allowing clients to compute elapsed time from their local clocks.

## Data Flow

### Real-Time State Synchronization

1. **Initial State**: Browser mounts → fetch `/api/state` (full snapshot)
2. **Change Detection**: Browser subscribes to Supabase Realtime on critical tables: `races`, `final`, `final_runs`, `queue`, `players`, `event`
3. **Debounced Refetch**: Any change triggers a debounced (120ms) `/api/state` refetch
4. **Polling Safety Net**: Fall-back polling every 10 seconds
5. **Render**: UI re-renders with new AppState

### Race Submission Flow

1. User types in lane view → characters accumulated in React state
2. Auto-submit triggers on deadline (300ms before end) or passage completion
3. `POST /api/submit` → server records `p1_text`/`p2_text` + `elapsed_ms`
4. If both lanes submitted, server calls `finalizeRace()` immediately
5. Scoring computed server-side (deterministic)
6. `races` table updated → Realtime broadcast → clients refetch → display results

### Admin-Initiated Flows

Admin actions (create race, lock final, etc.) require token header (`X-Admin-Token`):
1. Browser localStorage stores `adminToken` (set once via admin page)
2. Admin makes request to `/api/admin/*` with token in header
3. Server validates token via `requireAdmin()` middleware
4. Mutation executes, state broadcasts to all connected clients

## Key Modules and Responsibilities

### `lib/types.ts`
Type definitions for all domain objects: `Player`, `RaceRow`, `FinalRow`, `FinalRun`, `QueueRow`, `LBEntry`, `AppState`, `LiveView`.

### `lib/supabase.ts`
Dual Supabase client initialization:
- `supabaseBrowser()` — uses anon key, respects RLS policies
- `supabaseServer()` — uses service_role key, bypasses RLS (writes only)
- Realtime configured with 10 events/second rate limit

### `lib/state.ts` (940 lines)
**Server-side data layer** — all write operations flow through here:
- Event Management: `getEvent()`, `setEventStatus()`, `resetEventDay()`
- Players: `upsertPlayer()`, `getPlayer()`, `renamePlayer()`, `createAnonymousPlayer()`
- Race Lifecycle: `startRace()`, `submitTyped()`, `finalizeRace()` (idempotent), `abortRace()`
- Leaderboard: `leaderboard(limit)`, `top5()`
- Final Round: `lockFinal()`, `startFinalRun()`, `submitFinalTyped()`, `finalizeFinalRun()`
- Solo Runs: `startSoloRun()`, `submitSoloTyped()`, `finalizeSoloRun()`
- Head-to-Head Rooms: `createRoom()`, `joinRoom()`, `startRoom()`, `roomSubmit()`, `finalizeRoom()`

### `lib/scoring.ts`
**Deterministic scoring engine**:
- `classifyAndScore()` — aligns typed vs. target passage, classifies each mismatch as `case_mismatch`, `duplicate`, `transposition`, or `other`
- Metrics: `wpm = (correct_chars / 5) / (effectiveMs / 60000)`, `acc = (correct_chars / typed_len) * 100`, `score = wpm * (acc/100)² * 10`
- `determineWinner()` — tiebreaker: score → accuracy → correct_chars → finish time

### `lib/passages.ts`
Fixed library of two test passages (`p1`, `p2`). Stored in-code, not in DB — prevents cheating and survives DB resets.

### `lib/auth.ts`
Admin token validation: `requireAdmin()` checks `X-Admin-Token` header or `?token=` param. Dev mode: if `ADMIN_TOKEN` unset, all admin endpoints open.

### `components/useAppState.ts`
Real-time subscription hook: initial fetch on mount, subscribes to 6 tables via Supabase Realtime, debounced refetch (120ms), 10s polling fallback.

### `components/api.ts`
Thin fetch wrapper: auto-injects `X-Admin-Token` for `/api/admin/*`. Token stored/retrieved from localStorage.

## State Management Approach

### Server-Side State
**No in-memory state** — all state is in Supabase Postgres. Idempotent operations use optimistic locking via `eq('status', current_status)` to prevent double-scoring.

### Client-Side State
Single source of truth: `/api/state` endpoint. `AppState` object contains all needed UI state. No client-side mutations; refetch on change.

### Local Component State
- **Lane pages**: `useState(typed)` for keystroke buffer
- **Submission flag**: `useRef(submittedRef)` to prevent duplicate submissions
- **Phase detection**: computed from `live` object + wall-clock time

## Real-Time & Async Patterns

### Realtime Broadcast
Push model via Supabase Realtime. Clients receive change notification → debounced `/api/state` refetch (full snapshot, not delta patching). Why not delta? Risk of drift from concurrent updates; refetch is cheap.

### Idempotent Operations
Race finalization: multiple clients can call `POST /api/race/finalize` when deadline passes. DB uses optimistic locking (`UPDATE WHERE status = 'pending'`). First write succeeds; subsequent calls skip. Safe because scoring is deterministic.

### Client-Side Timing
Browser reads `starts_at`, `ends_at` timestamps from DB and computes remaining time locally. No server-side `setTimeout()`. Survives page reloads.

## Notable Design Decisions

**Wall-Clock Timestamps** — Vercel functions are stateless. No in-memory timers. Absolute timestamps in DB allow any client to compute elapsed time. Trade-off: relies on synchronized client clocks.

**No In-Memory Server State** — compatible with Vercel scaling. Event phase is computed on read: `countdown` if `now < starts_at`, `running` if in window and not done, `done` if `status = 'done'`.

**Dual Supabase Clients** — browser client (anon key, RLS-respecting, Realtime) vs server client (service_role, bypasses RLS, writes only). Service role key never shipped to browser.

**Leaderboard Best-Score Aggregation** — player's best score across all races/solo runs per day. Encourages multiple attempts; early bad races don't permanently hurt ranking.

**Event Day Scoping** — all entities keyed by `event_day` string. Reset is cheap (bump event_day); old data persists for audit/export.

**Head-to-Head Rooms as Isolated State** — `h2h_rooms` NOT scoped to `event_day`, enabling ad-hoc instant 1v1 races outside the formal event queue.

**Multi-Passage Solo Runs** — segments stored as JSON in `typed` field with `__SEG__` prefix. Avoids DB schema changes; backwards-compatible.

## Known Limitations

1. Cold starts: Vercel serverless can add 100–400ms latency after idle
2. Single admin token: shared secret stored in localStorage
3. No live opponent progress: passage highlighting is local-only
4. No rate limiting: unprotected public endpoints
5. Network dependency: every keystroke round-trips over internet (venue Wi-Fi must be reliable)

## Open Questions
- None currently identified
