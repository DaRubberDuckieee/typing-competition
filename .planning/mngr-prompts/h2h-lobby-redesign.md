You are working on a Next.js + Supabase typing-race app. The repo is your CWD.

GOAL: Replace the current head-to-head "share 3 URLs" flow with a proper lobby + room code flow.

USER STORY:
1. User clicks "Head to Head" → sees two buttons: "Create room" and "Join room"
2. "Create room" → enters their name → backend creates a room with a short shareable code (e.g. "X7P9Q2"). They land in a LOBBY page showing: the code, their name as Player 1, an empty "Waiting for player 2..." slot, and a disabled Start button.
3. "Join room" → user enters the code AND their name → joins as Player 2 → both players see the lobby update in real time.
4. With both players present, the Start button enables for either player. Click → 3-2-1 countdown → both players go to the typing game (60s).
5. Game proceeds, then results.

YOUR APPROACH (Agent B): LOBBY-FIRST REDESIGN.
- Treat this as a chance to refactor h2h around a true lobby model.
- You may design a new schema: e.g. `public.rooms` (a lobby concept) with a join_code, host_id, status, and link to a `races` row when the game starts. Or extend h2h_rooms with explicit lobby state. Make the call yourself.
- Build a real /lobby/[code] page that shows player slots filling in via Supabase Realtime, with the Start button gated on lobby.status = 'full'.
- Players claim a slot by submitting (code, name). No more pre-baked /1 and /2 lane URLs being shared — the lobby assigns them.
- Once started, route both players to the typing game with their assigned lane.
- Document your schema decisions in a comment at the top of the migration file.

CONSTRAINTS:
- Add a Supabase migration as `supabase/migrations/2026-04-26_lobby.sql` — additive only, idempotent.
- Read README.md and supabase/schema.sql first to understand conventions.
- Read .planning/codebase/ARCHITECTURE.md and CONVENTIONS.md if they exist.
- Don't break the existing scheduled-bracket flow (queue, races table for the main event). Your work is scoped to the instant-1v1 / head-to-head feature.
- It's OK if the existing h2h_rooms table becomes unused — you can leave it in place and route around it.

DELIVERABLE:
- Working create-with-name + join-with-name + lobby + start flow end-to-end on `npm run dev`
- A short summary at the end: what you changed, schema design, what tradeoffs you made vs. the minimal-change alternative.
- Do NOT commit or push. Leave changes uncommitted in the working tree.

Start by reading the codebase. Don't ask me questions — make sensible decisions and proceed. When done, call out anything you're uncertain about.
