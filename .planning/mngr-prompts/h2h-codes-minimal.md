You are working on a Next.js + Supabase typing-race app. The repo is your CWD.

GOAL: Replace the current head-to-head "share 3 URLs" flow with a "room code" flow.

USER STORY:
1. User clicks "Head to Head" → sees two buttons: "Create room" and "Join room"
2. "Create room" → backend creates a room, returns a short shareable code (e.g. "X7P9Q2"). User sees a waiting screen showing the code + "Waiting for opponent..."
3. "Join room" → user enters the code, gets joined to that room
4. When both players are in, EITHER player can press "Start". Both players are then taken to the typing game (60s).
5. Game proceeds as today, then results.

YOUR APPROACH (Agent A): MINIMAL CHANGE.
- Reuse the existing public.h2h_rooms table.
- Add ONE column: `code text unique` (6-char base32-ish, server-generated).
- Keep the existing schema otherwise — p1_name, p2_name, status enum, all the score columns.
- Wire: POST /api/h2h/create returns {id, code}. NEW: POST /api/h2h/join with {code, name} → looks up room by code, sets p2_name + p2_joined_at.
- Frontend: replace /head-to-head landing with create/join buttons. New /h2h/[id]/lobby page (or repurpose the spectator page) shows the code while waiting.
- Each player's lane page (/h2h/[id]/[lane]) is unchanged once the room is "ready".
- Status enum stays: waiting | ready | running | done.

CONSTRAINTS:
- Do NOT redesign the whole h2h flow. Make the smallest set of additive changes.
- Add a Supabase migration as `supabase/migrations/2026-04-26_h2h_room_codes.sql` (or similar) — additive only, idempotent.
- Don't break the existing spectator page; it can stay as a secondary view.
- Read README.md and supabase/schema.sql first to understand conventions.
- Read .planning/codebase/ARCHITECTURE.md and CONVENTIONS.md if they exist.
- Document your design choice at the top of the migration file in a comment.

DELIVERABLE:
- Working create/join flow end-to-end on `npm run dev`
- A short summary at the end: what you changed, what files, what tradeoffs you made.
- Do NOT commit or push. Leave changes uncommitted in the working tree.

Start by reading the codebase. Don't ask me questions — make sensible decisions and proceed. When done, call out anything you're uncertain about.
