# Braintrust Typing Race

Head-to-head typing competition for a live event. Built on **Next.js**,
**Supabase** (Postgres + Realtime), and deployed to **Vercel**.

## Architecture

```
Attendee / Player / Staff browsers
        │
        ▼
  Vercel (Next.js)
   ├── serves the React UI
   └── /api/* serverless routes
        │
        ▼
    Supabase
     ├── Postgres (durable state)
     └── Realtime (change feeds to browsers)
```

- **Browsers** subscribe to `races`, `final`, `final_runs`, `queue`, `event`
  via Supabase Realtime. On any change, they refetch `/api/state` and
  re-render.
- **Vercel serverless API routes** use the Supabase **service role** key to
  write to Postgres. They are the only writers.
- **Race timing is wall-clock-based.** The DB stores absolute `starts_at`
  and `ends_at` timestamps; clients compute "remaining seconds" from their
  local clock. There is no in-memory server state — any serverless invocation
  can serve any request.
- **Scoring is deterministic** and computed on the server from the final
  typed string + elapsed ms.
- **Finalization is idempotent.** When a client observes the deadline has
  passed, it calls `POST /api/race/finalize`. The server no-ops if the race
  is already done, so duplicate calls are safe.

## Scoring

- **WPM** = `(correct_chars / 5) / (elapsed_ms / 60000)`
- **Accuracy %** = `correct_chars / typed_len * 100`
- **Score** = `WPM × (acc/100)² × 10` — squaring accuracy penalizes sloppy typing.
- **Untyped tail** is not counted as error (just lowers WPM).
- **Ties** broken by: score → accuracy → correct_chars → earlier finish.
- **Error categories:** `case_mismatch`, `duplicate`, `transposition`, `other`.

## Leaderboard

- Scoped to the current `event_day`.
- Players keyed by normalized `(name, company)` per day.
- Leaderboard score = player's best score that day.
- Top 5 = first 5 by score desc, tiebreak acc desc, earliest achievement.

## Final round

- Admin locks top 5 → a `final` row is created with a randomized `order_json`.
- Admin clicks "Start next finalist" for each run. Same passage, same duration.
- Final ranking is computed only from final-round scores.
- When the 5th run finishes, event status → `final_done`. Normal races blocked.
- Optional "CEO bonus round" is a separate `final` row (isolated scoreboard).

---

## Setup

### 1. Create the Supabase project

1. Go to supabase.com → **New project**. Pick a region close to your Vercel
   region. Set a strong database password (save it).
2. Open the SQL editor and paste the entire contents of
   `supabase/schema.sql`. Click **Run**. Safe to re-run; everything is
   idempotent.
3. In **Project Settings → API**, copy:
   - `URL` → this is `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` key → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → this is `SUPABASE_SERVICE_ROLE_KEY` (server-only!)

### 2. Local development

```sh
cp .env.example .env.local
# fill in the four env vars (ADMIN_TOKEN can be blank in dev)
npm install
npm run dev
# open http://localhost:3000
```

### 3. Deploy to Vercel

```sh
npm i -g vercel
vercel                     # creates the Vercel project, follow prompts
```

Then, in the **Vercel dashboard → your project → Settings → Environment Variables**,
set these four:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | your service_role key (server-only) |
| `ADMIN_TOKEN` | a random string, e.g. `openssl rand -hex 24` |

Then:

```sh
vercel --prod
```

### Custom domain (optional)

Vercel → Project → Domains → add `race.yourdomain.com`. Set the DNS CNAME
to `cname.vercel-dns.com`. HTTPS is automatic.

---

## Operator (staff) cheat-sheet

**One-time on each staff laptop:**
1. Open `https://<your-domain>/admin`.
2. Paste your `ADMIN_TOKEN` into the **Admin token** field → **Save**.
   Stored in that browser's localStorage.

**Before the event:**
1. Staff machine: `/admin` tab.
2. Player 1 laptop: `/lane/1` tab.
3. Player 2 laptop: `/lane/2` tab.
4. Venue display: `/leaderboard`.
5. Sign-up laptop or QR code pointing to: `/signup`.

**Running a race:**
1. In Admin, click `→ P1` and `→ P2` next to two queued players (or type names).
2. Click **▶︎ Start race**. 3-2-1-GO on both lanes.
3. Race auto-ends at the deadline. Leaderboard updates.
4. Repeat.

**Other common actions:**
- **No-show:** click **Skip** next to the queued player.
- **Abort a race:** **Abort current** in Admin.
- **Run the final:** **🔒 Lock top-5 final** → switch display to `/final` →
  click **▶︎ Start next finalist** five times.
- **Export:** **📋 Export CSV** copies a CSV to your clipboard.
- **Reset for a new day:** **⚠︎ Reset event day** → confirm.

---

## Edge cases

| Scenario | Behavior |
|---|---|
| Client browser reload | Reconnects, refetches state, rejoins the current race. |
| Race deadline hits | Any client that sees `now >= ends_at` calls `/api/race/finalize`. Idempotent, so duplicates are safe. |
| Network hiccup on submit | Client retries on the next render; the 10s polling fallback also triggers. |
| Duplicate `(name, company)` signup | Reuses existing player id. |
| Same player plays multiple races | Only best score counts on the leaderboard. |
| Admin crashes browser mid-final | Reload `/admin`, click **Start next finalist** to continue; `final.current_index` is persisted. |
| Event-day reset | Bumps `event.event_day`. Old day's data remains in Postgres for export/audit but UI queries filter by current day. |

---

## Known limitations / next improvements

- **Cold starts** on Vercel serverless can add ~100–400ms to the first
  request after idle. Mitigation: ping the site every few minutes during
  the event, or upgrade to Vercel Pro for always-warm functions.
- **Admin token** is a single shared secret, stored in localStorage. For a
  multi-staff setup with audit trail, wire up Supabase Auth and replace
  `ADMIN_TOKEN` checks with `auth.jwt()` + RLS policies.
- **Live opponent progress** is not broadcast. The passage highlighting on
  each lane is local only. If you want an opponent progress bar, add a
  broadcast channel via Supabase Realtime presence.
- **No rate limiting.** Add `@vercel/firewall` or `upstash/ratelimit`
  middleware before a public launch.
- **Venue Wi-Fi matters.** Every keystroke submission round-trips over the
  internet. The venue network should be reliable for gameplay.

---

## Folder layout

```
typing-race/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                      # Home
│   ├── signup/page.tsx
│   ├── lane/[id]/page.tsx            # /lane/1, /lane/2
│   ├── leaderboard/page.tsx
│   ├── admin/page.tsx
│   ├── final/page.tsx
│   ├── results/page.tsx
│   └── api/
│       ├── state/route.ts            # full snapshot
│       ├── players/route.ts
│       ├── queue/route.ts
│       ├── submit/route.ts
│       ├── race/finalize/route.ts    # idempotent, public
│       ├── final/finalize/route.ts   # idempotent, public
│       └── admin/…                   # token-gated actions
├── components/
│   ├── TopBar.tsx
│   ├── api.ts
│   └── useAppState.ts                # Realtime hook
├── lib/
│   ├── supabase.ts
│   ├── scoring.ts
│   ├── passages.ts
│   ├── state.ts                      # server-side data layer
│   ├── auth.ts
│   └── types.ts
├── supabase/
│   └── schema.sql                    # paste-run in Supabase SQL editor
├── .env.example
├── next.config.mjs
├── package.json
├── tsconfig.json
└── README.md
```
