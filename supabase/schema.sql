-- Paste and run this entire file once in the Supabase SQL editor.
-- Safe to re-run: everything is `if not exists` or idempotent.

create extension if not exists pgcrypto;

-- --------- Singleton event row ---------
create table if not exists public.event (
  id int primary key check (id = 1),
  event_day text not null,
  status text not null,
  created_at timestamptz not null default now()
);

insert into public.event (id, event_day, status)
values (1, to_char(now(), 'YYYY-MM-DD'), 'running')
on conflict (id) do nothing;

-- --------- Players ---------
-- `phone` is the cross-day identity anchor for booth players (the conference
-- runs across multiple days; same person should be recognized on day 2/3).
-- Stored as E.164. The booth API requires it; the column itself stays
-- nullable so legacy/admin rows without a phone can coexist.
create table if not exists public.players (
  id text primary key,
  name text not null,
  title text,
  company text,
  phone text,
  event_day text not null,
  created_at timestamptz not null default now()
);
-- Migrations for existing projects:
alter table public.players add column if not exists phone text;
alter table public.players drop constraint if exists players_event_day_name_company_key;
-- Partial unique: enforce one row per phone, but allow multiple null-phone rows.
create unique index if not exists players_phone_unique on public.players (phone) where phone is not null;

-- --------- Queue ---------
create table if not exists public.queue (
  id text primary key,
  event_day text not null,
  player_id text not null references public.players(id) on delete cascade,
  position int not null,
  status text not null,        -- waiting | racing | done | noshow
  created_at timestamptz not null default now()
);
create index if not exists idx_queue_day on public.queue (event_day, status);

-- --------- Races ---------
-- Race timing is stored as absolute timestamps so the client can compute
-- remaining time from its local wall clock. No server-side setTimeout.
--
-- For booth flow: p1_id and p2_id can be null while a race is in 'waiting'
-- status (one player has joined and we're waiting for the other lane).
-- Once both are set, status flips to 'pending' (countdown).
create table if not exists public.races (
  id text primary key,
  event_day text not null,
  p1_id text references public.players(id),
  p2_id text references public.players(id),
  passage_id text not null,
  duration_s int not null,
  countdown_started_at timestamptz,
  starts_at timestamptz,       -- when "GO!" hits (countdown ends)
  ends_at timestamptz,         -- hard stop
  ended_at timestamptz,
  status text not null,        -- pending | running | done | aborted
  p1_text text,
  p2_text text,
  p1_submitted_at timestamptz,
  p2_submitted_at timestamptz,
  p1_elapsed_ms int,
  p2_elapsed_ms int,
  p1_score numeric,
  p2_score numeric,
  p1_wpm numeric,
  p2_wpm numeric,
  p1_acc numeric,
  p2_acc numeric,
  p1_errors jsonb,
  p2_errors jsonb,
  winner_id text,
  created_at timestamptz not null default now()
);
-- Multi-passage race support. Booth races pre-pick a list of passage IDs at
-- creation so both lanes type the exact same sequence; legacy admin races
-- leave this null and use the single-passage `passage_id` field.
alter table public.races add column if not exists passage_ids jsonb;
-- Migration for existing projects (additive: relax NOT NULL on player ids).
alter table public.races alter column p1_id drop not null;
alter table public.races alter column p2_id drop not null;
create index if not exists idx_races_day on public.races (event_day, status);
create index if not exists idx_races_day_created on public.races (event_day, created_at desc);

-- --------- Final round ---------
-- One row per locked final (top-5 or CEO bonus). The currently-running
-- finalist's state is kept on this row; completed runs are logged in final_runs.
create table if not exists public.final (
  id bigint generated always as identity primary key,
  event_day text not null,
  state text not null,                 -- locked | running | done
  passage_id text not null,
  duration_s int not null,
  order_json jsonb not null,           -- array of player_ids
  current_index int not null,
  started_at timestamptz,
  ended_at timestamptz,
  is_ceo boolean not null default false,
  -- in-flight current run:
  current_player_id text,
  current_countdown_started_at timestamptz,
  current_starts_at timestamptz,
  current_ends_at timestamptz,
  current_text text,
  current_elapsed_ms int,
  current_submitted_at timestamptz,
  current_status text,                 -- null | pending | done
  created_at timestamptz not null default now()
);
create index if not exists idx_final_day on public.final (event_day, is_ceo, id desc);

create table if not exists public.final_runs (
  id text primary key,
  final_id bigint not null references public.final(id) on delete cascade,
  player_id text not null references public.players(id),
  score numeric not null,
  wpm numeric not null,
  acc numeric not null,
  text text,
  errors jsonb,
  completed_at timestamptz not null default now()
);
create index if not exists idx_final_runs_final on public.final_runs (final_id);

-- --------- Solo runs (one-player "Play" mode) ---------
-- Anyone can walk up and play a solo timed run. Scores feed the leaderboard
-- alongside head-to-head race results.
create table if not exists public.solo_runs (
  id text primary key,
  event_day text not null,
  player_id text not null references public.players(id),
  passage_id text not null,
  duration_s int not null,
  countdown_started_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  status text not null,                -- pending | done | aborted
  typed text,
  elapsed_ms int,
  submitted_at timestamptz,
  score numeric,
  wpm numeric,
  acc numeric,
  errors jsonb,
  segments jsonb,                      -- [{passageId, typed, elapsedMs}] per completed + in-progress passage
  created_at timestamptz not null default now()
);
-- Migration for existing projects:
alter table public.solo_runs add column if not exists segments jsonb;
-- Day-end "final event" runs are stored in this same table but tagged so
-- the per-day event leaderboard can filter for them. Defaults to false so
-- the regular /play solo runs are unaffected.
alter table public.solo_runs add column if not exists is_event_run boolean default false;
create index if not exists idx_solo_day on public.solo_runs (event_day, status);
create index if not exists idx_solo_day_created on public.solo_runs (event_day, created_at desc);
create index if not exists idx_solo_event on public.solo_runs (event_day, is_event_run, status);

-- --------- Head-to-head rooms (instant 1v1) ---------
-- Two-player real-time race with three shared URLs: two players + one spectator.
create table if not exists public.h2h_rooms (
  id text primary key,
  passage_id text not null,
  duration_s int not null default 60,
  status text not null default 'waiting',   -- waiting | ready | running | done
  p1_name text,
  p2_name text,
  p1_joined_at timestamptz,
  p2_joined_at timestamptz,
  countdown_started_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  -- Live progress + final state per lane:
  p1_typed text,
  p1_elapsed_ms int,
  p1_submitted_at timestamptz,
  p1_score numeric,
  p1_wpm numeric,
  p1_acc numeric,
  p2_typed text,
  p2_elapsed_ms int,
  p2_submitted_at timestamptz,
  p2_score numeric,
  p2_wpm numeric,
  p2_acc numeric,
  winner text,                               -- '1' | '2' | 'tie'
  created_at timestamptz not null default now()
);
create index if not exists idx_h2h_rooms_status on public.h2h_rooms (status, created_at desc);

-- --------- Row-Level Security ---------
-- Clients use the anon key and can only read. Writes go through our API
-- routes using the service_role key (which bypasses RLS).
alter table public.event       enable row level security;
alter table public.players     enable row level security;
alter table public.queue       enable row level security;
alter table public.races       enable row level security;
alter table public.final       enable row level security;
alter table public.final_runs  enable row level security;
alter table public.solo_runs   enable row level security;
alter table public.h2h_rooms   enable row level security;

-- Public SELECT policies (browser needs to read for Realtime + /api/state).
-- Drop+create pattern is idempotent.
do $$ begin
  drop policy if exists "public read event"       on public.event;
  drop policy if exists "public read players"     on public.players;
  drop policy if exists "public read queue"       on public.queue;
  drop policy if exists "public read races"       on public.races;
  drop policy if exists "public read final"       on public.final;
  drop policy if exists "public read final_runs"  on public.final_runs;
  drop policy if exists "public read solo_runs"   on public.solo_runs;
  drop policy if exists "public read h2h_rooms"   on public.h2h_rooms;
end $$;

create policy "public read event"      on public.event      for select using (true);
create policy "public read players"    on public.players    for select using (true);
create policy "public read queue"      on public.queue      for select using (true);
create policy "public read races"      on public.races      for select using (true);
create policy "public read final"      on public.final      for select using (true);
create policy "public read final_runs" on public.final_runs for select using (true);
create policy "public read solo_runs"  on public.solo_runs  for select using (true);
create policy "public read h2h_rooms"  on public.h2h_rooms  for select using (true);

-- --------- Realtime publication ---------
-- Enable change feeds on the tables the UI subscribes to.
-- `supabase_realtime` is Supabase's default publication.
-- Realtime publication (wrap in a DO block so re-runs don't error if already added).
do $$ begin
  begin alter publication supabase_realtime add table public.event;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.players;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.queue;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.races;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.final;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.final_runs;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.solo_runs;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.h2h_rooms;   exception when duplicate_object then null; end;
end $$;
