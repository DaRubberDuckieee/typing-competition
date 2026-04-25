# CONCERNS
_Last updated: 2026-04-25_

## Summary

This is a deliberately scoped, event-day tool — not a long-running production service — so many patterns that would be unacceptable in a larger product are acceptable here. That said, several real risks exist: the admin panel is completely open when `ADMIN_TOKEN` is unset (designed for dev, but easy to forget in prod), there is no rate limiting on any public endpoint (queue spam, solo-run flood), player ownership is entirely unverified so any client can rename or submit on behalf of any player by guessing a nanoid, and there are no automated tests. The data layer and serverless-stateless design are solid. The biggest day-of risk is an operator shipping without setting `ADMIN_TOKEN`, followed by score manipulation from a technical attendee who inspects network requests.

## Critical

**Admin panel is fully open when `ADMIN_TOKEN` env var is unset**
- Risk: Anyone who discovers `/admin` or any `/api/admin/*` route can start/abort races, reset the event, export attendee data, or lock finals.
- File: `lib/auth.ts` line 8 (`if (!expected) return null; // open for local dev`)
- Fix: Add a startup check that refuses to serve admin routes if `ADMIN_TOKEN` is unset, rather than silently opening them.

**`ADMIN_TOKEN` accepted as a plain query-string parameter**
- Risk: `?token=<secret>` appears in server access logs, browser history, and referrer headers. One accidental copy-paste or screenshot exposes the token.
- File: `lib/auth.ts` line 9 (`new URL(req.url).searchParams.get('token')`)
- Fix: Remove the query-string path; require the `X-Admin-Token` header only.

## High

**No rate limiting on any public endpoint**
- Risk: Any client can POST `/api/queue` in a loop to flood the queue with fake entries, POST `/api/play/start` to create thousands of solo runs, or POST `/api/h2h/create` to fill the database with orphaned rooms.
- Files: `app/api/queue/route.ts`, `app/api/play/start/route.ts`, `app/api/h2h/create/route.ts`
- Fix: Add Vercel Edge middleware or a simple in-process token-bucket per IP for unauthenticated write endpoints.

**Player ownership is unverified — any client can submit or rename any player**
- Risk: A user who captures another player's `player_id` (visible in `/api/state` JSON, leaderboard, browser DevTools) can POST `/api/submit` to overwrite their typed text, call `/api/player/<id>/rename` to change their display name, or POST `/api/play/submit` to zero out their score mid-run.
- Files: `app/api/submit/route.ts`, `app/api/player/[id]/rename/route.ts`, `app/api/play/submit/route.ts`
- Fix: Issue a short-lived session token at signup/run-start; store in localStorage; require it on submit and rename.

**`/api/state` is an expensive, unauthenticated, uncached global snapshot**
- Risk: `appState()` makes 5+ parallel Supabase queries per call. With many clients subscribed to Realtime and frequent DB changes, the 120ms debounce per-client creates a thundering herd, burning Supabase connection limits.
- Files: `lib/state.ts` → `appState()`, `components/useAppState.ts`
- Fix: Add a 1–2s server-side stale-while-revalidate cache on `/api/state` to coalesce burst traffic.

**No input validation on `durationS` or `passageId` for public run-start endpoints**
- Risk: A client can POST `{ durationS: 86400 }` to create a run that expires in 24 hours, polluting leaderboard queries.
- Files: `lib/state.ts` → `startSoloRun`, `createRoom`; `lib/passages.ts` → `getPassage` (silent fallback)
- Fix: Whitelist valid `passageId` values; clamp `durationS` to a max (e.g., 120s); throw on unknown passage ID.

**No automated tests**
- Risk: Zero test files exist. The scoring algorithm, leaderboard aggregation, segment encoding/decoding, and winner determination are all untested. A regression during the event cannot be quickly verified.
- Fix: Add unit tests for `classifyAndScore`, `determineWinner`, `encodeSegments`/`decodeSegments`, and `leaderboard` — all pure functions with no external dependencies, easy to cover with Vitest.

## Medium

**Segment data encoded as a magic-prefix string in a TEXT column instead of the existing JSONB column**
- Files: `lib/state.ts` lines 723–737 (`SEG_PREFIX`, `encodeSegments`, `decodeSegments`); `supabase/schema.sql` line 136 (`segments jsonb` column exists but is bypassed)
- Impact: Any query reading `typed` as plain text (manual SQL export, analytics) gets garbled data. Two incompatible formats exist simultaneously.
- Fix: Migrate to writing segments directly to the `segments JSONB` column and drop the `__SEG__` encoding.

**`/api/state` exposes raw typed text of all in-progress submissions to all clients**
- Files: `lib/state.ts` — `live` object spreads entire `RaceRow`/`FinalRow` including `p1_text`, `p2_text`, `current_text`
- Impact: Players can read each other's in-progress typed content by inspecting network responses — a fairness issue in a competition.
- Fix: Strip typed-text fields from the public state snapshot.

**Queue has no duplicate-entry prevention — same player can queue multiple times**
- Files: `lib/state.ts` → `enqueue()`, `app/api/queue/route.ts`
- Fix: Add a DB unique constraint on `(event_day, player_id)` for `status='waiting'` queue entries.

**`appState()` makes a serial `getPlayer()` DB call inside the `live` block (final round path)**
- Files: `lib/state.ts` lines 542–551
- Fix: Include player lookup in the initial `Promise.all`, or pre-join player data in `currentFinal`.

**`status` fields have no DB CHECK constraints**
- Files: `supabase/schema.sql` — `races`, `queue`, `solo_runs` all use `status text not null` with no constraint
- Impact: A bug or manual SQL edit could insert an unrecognized status, causing silent misbehavior.
- Fix: Add `CHECK (status IN (...))` constraints.

**Admin token stored in `localStorage` — persists indefinitely, accessible from any tab**
- Files: `components/api.ts`, `app/admin/page.tsx`
- Fix: Use `sessionStorage` so the token clears when the tab closes.

## Low

**Only two hardcoded passages — no variety across a multi-hour event**
- Files: `lib/passages.ts`, `lib/state.ts` line 379 (final round hardcoded to `'p2'`)
- Impact: Returning players or observers will have memorized the passage text.

**`getPassage()` silently falls back to `PASSAGES[0]` for unknown IDs**
- Files: `lib/passages.ts` line 21
- Fix: Throw a descriptive error for unknown passage IDs rather than silently defaulting.

**No structured logging or error monitoring**
- Only three `console.error` calls exist in `lib/state.ts`. No Sentry, no structured log format. A prior silent failure is referenced in a comment at line 767.
- Files: `lib/state.ts` lines 767, 832, 923

**Pervasive `any` types in core business logic**
- Files: `lib/types.ts` lines 31–32, 72, 95; `lib/state.ts` (numerous `patch: any`, `live: any`, `as any` casts)
- Fix: Define a typed `ErrorCounts` type; type `ceoFinal` properly.

**`eslint-disable-next-line react-hooks/exhaustive-deps` suppressions indicate stale closure risks**
- Files: `app/lane/[id]/page.tsx` lines 72, 83; `app/play/page.tsx` lines 165, 178
- Fix: Use `useCallback` with correct dependencies or `useRef` to hold latest values.

**Route `/lane/[id]` uses `id` param as a lane number, not a race ID — confusing naming**
- Files: `app/lane/[id]/page.tsx` line 18
- Fix: Rename route to `/lane/[lane]`.

**`useRoom` fetch error path silently swallows exceptions**
- Files: `components/useRoom.ts` line 57 (`catch {}`)
- Fix: Set `error` state on network failure, not just on non-OK HTTP responses.

## Open Questions

- Is `.env.local` intended to be committed? It is gitignored correctly but exists on disk — confirm it contains only non-production credentials.
- `races.status` can be `'pending'` or `'running'`, but `startRace()` always inserts `status: 'pending'` and nothing transitions it to `'running'`. Is `running` a dead status value or planned-but-unimplemented?
- `h2h_rooms` has no `event_day` column — rooms persist across event resets. Intentional (h2h is out-of-band) or oversight?
- The final round passage is hardcoded to `'p2'` in `lockFinal()`. Intentional for this event, or should it be configurable?
- No cleanup of stale h2h rooms, abandoned solo runs, or orphaned queue entries. Fine for a one-day event, but worth noting if the tool is reused.
