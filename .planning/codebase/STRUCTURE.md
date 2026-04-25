# Braintrust Typing Race - Directory & File Structure
_Last updated: 2026-04-25_

## Summary

Next.js App Router project with a clear separation: `lib/` for shared server/browser logic, `components/` for reusable UI and hooks, `app/` for pages and API routes, and `supabase/` for the database schema. The data layer is concentrated in `lib/state.ts` (940 lines), which is the single file to understand for all state mutations.

## Root Directory

```
typing-race/
├── .env.example              # Template for environment variables
├── .env.local               # Local secrets (SUPABASE_URL, keys, ADMIN_TOKEN)
├── .gitignore
├── next.config.mjs          # Next.js config (reactStrictMode: true)
├── tsconfig.json            # TypeScript strict config, path aliases (@/*)
├── package.json             # Dependencies (next, react, supabase-js, nanoid)
├── package-lock.json
├── README.md                # Setup guide, operator cheat-sheet, edge cases
├── GSD-INSTRUCTIONS.md      # Project management docs
├── supabase/                # Database schema
│   └── schema.sql           # Complete Postgres schema
├── lib/                     # Shared server/browser utilities
├── components/              # Reusable React components
├── app/                     # Next.js App Router (pages + API routes)
├── .next/                   # Build output (Next.js)
├── .vercel/                 # Vercel metadata
└── node_modules/
```

## `lib/` - Shared Logic

**Purpose**: Reusable functions and types shared between server and client code.

```
lib/
├── types.ts                 # TypeScript type definitions
│   ├── Player              # { id, name, title, company, event_day }
│   ├── RaceRow             # Head-to-head race state + scores
│   ├── FinalRow            # Current final round state
│   ├── FinalRun            # Completed finalist run record
│   ├── QueueRow            # Queue position + status
│   ├── LBEntry             # Leaderboard entry
│   ├── AppState            # Full snapshot for clients
│   └── LiveView            # Union type: race or final + passage
│
├── supabase.ts             # Dual Supabase client initialization
│   ├── supabaseBrowser()   # Anon key (browser)
│   └── supabaseServer()    # Service role key (server only)
│
├── state.ts                # SERVER-SIDE DATA LAYER (940 lines)
│   ├── Event Management    # getEvent(), setEventStatus(), resetEventDay()
│   ├── Players             # upsertPlayer(), getPlayer(), renamePlayer(), createAnonymousPlayer()
│   ├── Race Lifecycle      # startRace(), submitTyped(), finalizeRace() (idempotent), abortRace()
│   ├── Leaderboard         # leaderboard(limit), top5()
│   ├── Final Round         # lockFinal(), startFinalRun(), submitFinalTyped(), finalizeFinalRun()
│   ├── Solo Runs           # startSoloRun(), submitSoloTyped(), finalizeSoloRun()
│   ├── Head-to-Head Rooms  # createRoom(), joinRoom(), startRoom(), roomSubmit(), finalizeRoom()
│   └── Utilities           # leaderboard() in-memory aggregation, exportCsv()
│
├── scoring.ts              # Deterministic scoring engine
│   ├── classifyAndScore()  # Align typed vs target, categorize errors
│   ├── ScoreResult type    # correctChars, wpm, acc, score, errors
│   └── determineWinner()   # Tiebreaker logic
│
├── passages.ts             # Fixed passage library
│   ├── PASSAGES[]          # Two hardcoded passages (p1: code snippet, p2: system prompt)
│   ├── getPassage(id)
│   └── randomQualifyingPassage()
│
└── auth.ts                 # Admin token validation
    ├── requireAdmin()      # Middleware: checks X-Admin-Token header
    └── readBody()          # Safe JSON parse
```

## `components/` - Reusable UI & Hooks

```
components/
├── useAppState.ts          # Real-time state subscription hook
│   └── useAppState()       # { state, refresh(), connected }
│       ├── Initial fetch: GET /api/state
│       ├── Realtime subs: 6 tables (races, final, final_runs, queue, players, event)
│       ├── Debounced refetch: 120ms
│       └── Polling fallback: 10s
│
├── api.ts                  # Fetch wrapper
│   ├── getAdminToken()     # localStorage read
│   ├── setAdminToken()     # localStorage write
│   └── api<T>()            # fetch() + X-Admin-Token injection for /api/admin/*
│
└── TopBar.tsx              # Navigation header (shared across all pages)
```

## `app/` - Next.js App Router

### Layout & Shared

```
app/
├── layout.tsx              # Root layout: Inter + Space_Grotesk fonts, metadata, TopBar
└── page.tsx                # / - Homepage: hero, "Play Now" CTA, top-10 leaderboard
```

### Player Pages

```
├── signup/page.tsx         # /signup - Register name, company, title for event queue
├── play/page.tsx           # /play - Solo "just type" mode (anonymous, 60s, multi-passage)
├── lane/[id]/page.tsx      # /lane/1, /lane/2 - Live race typing view
│   ├── Keystroke capture + passage highlighting
│   ├── Phase: countdown → running → done
│   └── Auto-submit on completion or deadline (300ms before end)
├── leaderboard/page.tsx    # /leaderboard - Full standings by event_day
├── results/page.tsx        # /results - Post-race breakdown: WPM, accuracy, errors
└── final/page.tsx          # /final - Finals display: current finalist + past runs
```

### Admin & Event Management

```
├── admin/page.tsx          # /admin - Staff dashboard
│   ├── Admin token input (localStorage)
│   ├── Create race (select two players from queue)
│   ├── Manage queue (skip, mark done)
│   ├── Lock finals (top 5 or custom CEO)
│   ├── CSV export
│   └── Event reset
```

### Head-to-Head Instant 1v1

```
├── head-to-head/page.tsx        # /head-to-head - Create/join interface
├── h2h/[id]/page.tsx            # /h2h/<roomId> - Spectator view
└── h2h/[id]/[lane]/page.tsx     # /h2h/<roomId>/1 or /2 - Player lanes
```

### API Routes (`app/api/`)

#### Public State

```
api/state/route.ts          # GET /api/state - Full AppState snapshot (no cache)
api/players/route.ts        # GET + POST /api/players - List / sign up
api/queue/route.ts          # GET /api/queue
```

#### Race (Public, Idempotent)

```
api/submit/route.ts                  # POST /api/submit - Record typed text (race or final)
api/race/finalize/route.ts           # POST /api/race/finalize - Trigger finalization
api/final/finalize/route.ts          # POST /api/final/finalize - Finalize final run
api/player/[id]/rename/route.ts      # PUT /api/player/[id]/rename
```

#### Solo Runs

```
api/play/start/route.ts     # POST - Create solo run
api/play/submit/route.ts    # POST - Record typed (single or multi-segment)
api/play/finalize/route.ts  # POST - Score run
api/play/[id]/route.ts      # GET - Fetch run state
```

#### Head-to-Head Rooms

```
api/h2h/create/route.ts         # POST - Create room
api/h2h/[id]/route.ts           # GET - Fetch room state
api/h2h/[id]/join/route.ts      # POST - Add player to lane
api/h2h/[id]/start/route.ts     # POST - Begin countdown
api/h2h/[id]/submit/route.ts    # POST - Submit text
api/h2h/[id]/finalize/route.ts  # POST - Score room
```

#### Admin (Token-Gated via `X-Admin-Token` header)

```
api/admin/race/start/route.ts           # POST - Create race (requires p1 + p2)
api/admin/race/abort/route.ts           # POST - Cancel race
api/admin/race/finalize/route.ts        # POST - Force finalization
api/admin/race/clear/route.ts           # POST - Clear current race
api/admin/queue/[id]/done/route.ts      # POST - Mark player done
api/admin/queue/[id]/skip/route.ts      # POST - Skip queued player
api/admin/final/lock/route.ts           # POST - Lock top 5 for final
api/admin/final/ceo-lock/route.ts       # POST - Lock custom CEO bonus round
api/admin/final/[id]/start-next/route.ts # POST - Start next finalist
api/admin/event/reset/route.ts          # POST - Bump event_day
api/admin/export/route.ts               # POST - Export CSV
```

## `supabase/` - Database Schema

```
supabase/schema.sql
├── event           # Singleton (id=1): event_day, status
├── players         # One per (event_day, name, company); nanoid(10) IDs
├── queue           # Competition queue: player_id, position, status
├── races           # Head-to-head: timing timestamps, p1/p2 text+scores, status
├── final           # Final round: order_json (shuffled), current_index, in-flight state
├── final_runs      # Immutable log of completed finalist runs
├── solo_runs       # Solo "Play" mode: single-passage or multi-segment (typed field)
└── h2h_rooms       # Instant 1v1: NOT event-scoped, ephemeral
```

**Schema highlights:**
- Absolute timestamps (`starts_at`, `ends_at`) enable stateless clients to compute elapsed time
- `order_json` (JSONB) stores shuffled finalist order for final round
- `(event_day, name, company)` unique constraint on players
- No `CHECK` constraints on `status` fields (any string accepted)

## Key File Locations Quick Reference

| What? | Where? |
|---|---|
| Scoring logic | `lib/scoring.ts` |
| Type definitions | `lib/types.ts` |
| All data mutations | `lib/state.ts` |
| Passages | `lib/passages.ts` |
| Real-time hook | `components/useAppState.ts` |
| Admin token | `components/api.ts` |
| Database schema | `supabase/schema.sql` |
| Full state endpoint | `app/api/state/route.ts` |
| Admin API | `app/api/admin/**/route.ts` |
| Solo runs API | `app/api/play/**/route.ts` |
| Instant 1v1 API | `app/api/h2h/**/route.ts` |
| Player lane UI | `app/lane/[id]/page.tsx` |
| Admin dashboard | `app/admin/page.tsx` |
| Homepage | `app/page.tsx` |

## Open Questions
- None currently identified
