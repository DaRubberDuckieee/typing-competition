// Server-side data layer. All writes flow through these functions using the
// Supabase service_role key (bypasses RLS). Every operation is async.
//
// Design notes:
// - Race/final "phase" is derived from timestamps + status on read. There is
//   no in-memory state on the server, which makes Vercel's serverless model
//   fine: any invocation can serve any request.
// - `finalizeRace` is idempotent (no-op if the race is already done) so it
//   can be called by either client when time expires without causing dupes.
// - Leaderboard aggregation is done in-memory; dataset is tiny (hundreds of
//   rows for an event).

import { nanoid } from 'nanoid';
import { supabaseServer } from './supabase';
import { classifyAndScore, determineWinner } from './scoring';
import {
  getPassage,
  randomQualifyingPassage,
  PASSAGES,
  FINALS_PASSAGES,
  pickFinalsPassageIds,
  getFinalsPassage,
} from './passages';
import { isEventOpenNow } from './eventTime';
import type { AppState, LBEntry, RaceRow, FinalRow, FinalRun } from './types';

const COUNTDOWN_MS = 3000;

// Real calendar day in YYYY-MM-DD (UTC). The booth uses this for stamping
// new players/races and for the "Today" leaderboard filter, so the boards
// auto-rotate at UTC midnight without anyone touching the `event` row.
// (The `event` table's `event_day` is now only used as a manual override
// hint and isn't trusted for anything date-dependent.)
function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------- Event ----------
export async function getEvent() {
  const sb = supabaseServer();
  const { data, error } = await sb.from('event').select('*').eq('id', 1).single();
  if (error) throw error;
  return data as { id: number; event_day: string; status: string };
}

export async function setEventStatus(status: string) {
  const sb = supabaseServer();
  await sb.from('event').update({ status }).eq('id', 1);
}

export async function resetEventDay(newDay?: string) {
  const sb = supabaseServer();
  const day = newDay || new Date().toISOString().slice(0, 10) + '-' + Date.now();
  await sb.from('event').update({ event_day: day, status: 'running' }).eq('id', 1);
  return day;
}

// ---------- Players ----------
export async function upsertPlayer(input: { name: string; title?: string; company?: string }) {
  const sb = supabaseServer();
  const ev = await getEvent();
  const name = (input.name || '').trim();
  const company = (input.company || '').trim();
  const title = (input.title || '').trim();
  if (!name) throw new Error('name_required');

  const { data: existing } = await sb
    .from('players')
    .select('*')
    .eq('event_day', ev.event_day)
    .eq('name', name)
    .eq('company', company)
    .maybeSingle();
  if (existing) return existing;

  const id = nanoid(10);
  const { data, error } = await sb
    .from('players')
    .insert({ id, name, title, company, event_day: ev.event_day })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPlayer(id: string) {
  const sb = supabaseServer();
  const { data } = await sb.from('players').select('*').eq('id', id).maybeSingle();
  return data;
}

// ---------- Phone-based identity (booth flow) ----------
// The booth needs to recognize returning players across the 3-day conference
// without taking emails. Phone is the cross-day key: the InfoForm collects it,
// we normalize to E.164 server-side, and either reuse the existing players
// row (and surface their personal best in the UI) or create a new one.

export type PhoneIdentity = {
  player: any;
  returning: boolean;
  previousBestWpm: number | null;
  previousBestScore: number | null;
};

// Normalize a user-entered phone string to E.164. Returns null if we can't
// produce a real-looking 10-15 digit number. Conference is US-based, so a
// bare 10-digit input is treated as US and prefixed with +1; explicit +cc
// input passes through. Anything under 10 digits is rejected so the booth
// API can surface a clear "invalid phone" error to the form.
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  if (hasPlus) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

// Look up a player's best WPM and best score across every completed race
// and solo run they've taken part in. Used to greet returning players with a
// target to beat. O(N) over their personal history; trivial at booth scale.
async function getPlayerBest(
  playerId: string,
): Promise<{ previousBestWpm: number | null; previousBestScore: number | null }> {
  const sb = supabaseServer();
  const [racesP1, racesP2, solos] = await Promise.all([
    sb.from('races').select('p1_wpm,p1_score').eq('p1_id', playerId).eq('status', 'done'),
    sb.from('races').select('p2_wpm,p2_score').eq('p2_id', playerId).eq('status', 'done'),
    sb.from('solo_runs').select('wpm,score').eq('player_id', playerId).eq('status', 'done'),
  ]);

  let bestWpm: number | null = null;
  let bestScore: number | null = null;
  const consider = (w: any, s: any) => {
    const wn = Number(w);
    const sn = Number(s);
    if (Number.isFinite(wn) && (bestWpm === null || wn > bestWpm)) bestWpm = wn;
    if (Number.isFinite(sn) && (bestScore === null || sn > bestScore)) bestScore = sn;
  };
  for (const r of racesP1.data || []) consider((r as any).p1_wpm, (r as any).p1_score);
  for (const r of racesP2.data || []) consider((r as any).p2_wpm, (r as any).p2_score);
  for (const s of solos.data || []) consider((s as any).wpm, (s as any).score);
  return { previousBestWpm: bestWpm, previousBestScore: bestScore };
}

// Look up a player by phone (cross-day identity). If found, returns the
// existing row with `returning: true` plus their personal best stats so the
// UI can show "Welcome back, you got 62 WPM last time." If not, creates a
// new players row tied to the current event_day. Throws on invalid phone
// (caller should map this to a 400 with a helpful message).
export async function findOrCreatePlayerByPhone(input: {
  phone: string;
  name: string;
  title?: string;
  company?: string;
}): Promise<PhoneIdentity> {
  const sb = supabaseServer();
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error('phone_invalid');
  const name = (input.name || '').trim();
  if (!name) throw new Error('name_required');

  const { data: existing, error: lookupErr } = await sb
    .from('players')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();
  if (lookupErr) throw lookupErr;

  if (existing) {
    const best = await getPlayerBest(existing.id);
    return { player: existing, returning: true, ...best };
  }

  const id = nanoid(10);
  const { data, error } = await sb
    .from('players')
    .insert({
      id,
      name,
      title: (input.title || '').trim(),
      company: (input.company || '').trim(),
      phone,
      // Stamp with today's real UTC date so this player flows into the
      // "Today" leaderboard regardless of when the `event` row was last
      // touched.
      event_day: todayString(),
    })
    .select()
    .single();
  if (error) throw error;
  return { player: data, returning: false, previousBestWpm: null, previousBestScore: null };
}

// ---------- Booth flow (auto-paired 1v1 races) ----------
// Two laptops at the conference booth, statically pinned to lane 1 and lane 2.
// When a player submits their info on either laptop, we either attach them to
// the open race or create a new one. Once both lanes are filled, the race
// transitions to 'pending' (countdown) -> 'running' -> 'done'.
//
// Reuses the existing `races` table so leaderboard aggregation "just works."
// Adds a 'waiting' status convention for races that have one lane filled.

// Race-scoped "segments" matching the solo_runs encoding: completed +
// in-progress passages get JSON-encoded into the p{lane}_text column with a
// `__SEG__` prefix so we don't need a separate column.
export type RaceSegment = { passageId: string; typed: string; elapsedMs: number };
const RACE_SEG_PREFIX = '__SEG__';
function encodeRaceSegments(segs: RaceSegment[]): string {
  return RACE_SEG_PREFIX + JSON.stringify(segs);
}
function decodeRaceSegments(s: string | null | undefined): RaceSegment[] | null {
  if (!s || !s.startsWith(RACE_SEG_PREFIX)) return null;
  try {
    const parsed = JSON.parse(s.slice(RACE_SEG_PREFIX.length));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Pick a deterministic-ish list of passage IDs for a new booth race. The
// FIRST slot is always one of the prose passages that mentions Braintrust
// — every booth race opens with brand context so onlookers see the pitch
// even if a player only finishes one passage. The rest are a shuffled mix
// of the remaining passages. Both lanes read this list back from the race
// row so they see the same sequence.
function pickRacePassageIds(): string[] {
  const intros = PASSAGES.filter(
    (p) => p.kind === 'prose' && /braintrust/i.test(p.text),
  );
  // Pick a random Braintrust intro for variety across races. Falls back to
  // PASSAGES[0] if no brand prose exists (defensive against future edits).
  const intro = intros.length > 0
    ? intros[Math.floor(Math.random() * intros.length)]
    : PASSAGES[0];
  const remaining = PASSAGES.filter((p) => p.id !== intro.id).map((p) => p.id);
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  // 1 intro + up to 7 more = 8 total. Enough for the fastest typist to
  // never run out in 60s.
  return [intro.id, ...remaining.slice(0, 7)];
}

// How long after creation a 'waiting' race is still considered "open" for
// the other lane to join. After this window, we treat the race as a zombie
// (the original sitter abandoned) and create a fresh one. 2 minutes covers
// realistic booth pacing — a player walking up, filling the form, and the
// other player following — without auto-pairing strangers across hours.
const BOOTH_OPEN_RACE_WINDOW_MS = 2 * 60 * 1000;

// Find the most recent race for today that is still accepting players for
// this lane, i.e. our lane is null and the other lane isn't this same player.
// Returns null if we should create a new race.
async function findOpenBoothRace(eventDay: string, lane: '1' | '2', playerId: string) {
  const sb = supabaseServer();
  const myCol = `p${lane}_id`;
  const otherCol = `p${lane === '1' ? '2' : '1'}_id`;
  // Only adopt races that started recently. Otherwise a stale race from an
  // earlier abandoned session (one lane already filled by a ghost) would
  // pair with the new player and immediately flip to running without
  // anyone actually being on the other side.
  const cutoff = new Date(Date.now() - BOOTH_OPEN_RACE_WINDOW_MS).toISOString();
  const { data } = await sb
    .from('races')
    .select('*')
    .eq('event_day', eventDay)
    .in('status', ['waiting', 'pending'])
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(5);
  for (const r of (data || []) as any[]) {
    if (r[myCol] === null && r[otherCol] !== playerId) return r as RaceRow;
  }
  return null;
}

// Attach this player to a booth race. Either fills our lane on an open race or
// creates a new race with us as p{lane}. If both lanes are now filled, flips
// the race into 'pending' with countdown timestamps so both clients start their
// countdown in lockstep. Returns the resulting race row + identity info.
export async function boothSitDown(input: {
  lane: '1' | '2';
  phone: string;
  name: string;
  title?: string;
  company?: string;
}): Promise<{
  race: RaceRow;
  playerId: string;
  returning: boolean;
  previousBestWpm: number | null;
  previousBestScore: number | null;
}> {
  const sb = supabaseServer();
  if (input.lane !== '1' && input.lane !== '2') throw new Error('lane_invalid');
  const ev = await getEvent();
  if (ev.status !== 'running') throw new Error('event_not_running');
  const today = todayString();

  const identity = await findOrCreatePlayerByPhone({
    phone: input.phone,
    name: input.name,
    title: input.title,
    company: input.company,
  });
  const playerId = identity.player.id;
  const myCol = `p${input.lane}_id`;
  const otherCol = `p${input.lane === '1' ? '2' : '1'}_id`;

  // First try to attach to an existing open race for today. The .is(myCol,
  // null) on the update is our optimistic lock against a concurrent join
  // from the same lane. We scope by today's date so stale 'waiting' races
  // from previous days never get adopted.
  const open = await findOpenBoothRace(today, input.lane, playerId);
  let race: RaceRow | null = null;

  if (open) {
    const { data, error } = await sb
      .from('races')
      .update({ [myCol]: playerId })
      .eq('id', open.id)
      .is(myCol, null)
      .select()
      .single();
    if (error || !data) {
      // Lost the race against another concurrent join — fall through to create.
      race = null;
    } else {
      race = data as RaceRow;
    }
  }

  if (!race) {
    // Pre-pick a list of passages so both lanes type the same sequence. The
    // first one in the list also fills `passage_id` for legacy compatibility.
    const passageIds = pickRacePassageIds();
    const id = nanoid(10);
    const { data, error } = await sb
      .from('races')
      .insert({
        id,
        // Stamp with today (real UTC date) so the "Today" leaderboard
        // surfaces this race on the calendar day it was actually played.
        event_day: today,
        passage_id: passageIds[0],
        passage_ids: passageIds,
        duration_s: 60,
        [myCol]: playerId,
        status: 'waiting',
      })
      .select()
      .single();
    if (error) throw error;
    race = data as RaceRow;
  }

  // If both lanes are now filled, flip to 'running' with countdown timestamps.
  // The 3s countdown lives client-side (driven by starts_at vs wall clock);
  // the race is conceptually "running" the moment both players are committed.
  // Idempotent + optimistic via .eq('status', 'waiting') so concurrent joins
  // can't double-flip.
  if ((race as any)[myCol] && (race as any)[otherCol] && race.status === 'waiting') {
    const now = Date.now();
    const { data: started } = await sb
      .from('races')
      .update({
        status: 'running',
        countdown_started_at: new Date(now).toISOString(),
        starts_at: new Date(now + COUNTDOWN_MS).toISOString(),
        ends_at: new Date(now + COUNTDOWN_MS + race.duration_s * 1000).toISOString(),
      })
      .eq('id', race.id)
      .eq('status', 'waiting')
      .select()
      .single();
    if (started) race = started as RaceRow;
  }

  return {
    race,
    playerId,
    returning: identity.returning,
    previousBestWpm: identity.previousBestWpm,
    previousBestScore: identity.previousBestScore,
  };
}

type BoothCurrentSnapshot = {
  race: RaceRow | null;
  p1: any | null;
  p2: any | null;
  passages: { id: string; text: string }[];
};

async function expandBoothRace(race: RaceRow | null): Promise<BoothCurrentSnapshot> {
  if (!race) return { race: null, p1: null, p2: null, passages: [] };

  const sb = supabaseServer();
  const idList = (race.passage_ids && race.passage_ids.length > 0)
    ? race.passage_ids
    : [race.passage_id];
  const passages = idList.map((pid) => {
    const p = getPassage(pid);
    return { id: p.id, text: p.text };
  });
  const ids = [race.p1_id, race.p2_id].filter(Boolean) as string[];
  let p1: any = null;
  let p2: any = null;
  if (ids.length > 0) {
    const { data: players } = await sb.from('players').select('*').in('id', ids);
    const byId = new Map((players || []).map((p: any) => [p.id, p]));
    p1 = race.p1_id ? byId.get(race.p1_id) || null : null;
    p2 = race.p2_id ? byId.get(race.p2_id) || null : null;
  }
  return { race, p1, p2, passages };
}

// Snapshot the booth's "current" race for the booth lane page.
// Returns the most recent race for today plus both player rows and the
// ordered list of passages for this race (booth races pre-pick 8). Callers
// should not cache this (use no-store at the route). If a race id is provided,
// return that race instead so a joined laptop stays attached to its own
// session through the result screen.
//
// IMPORTANT: filters by todayString() (real UTC date) to match what
// boothSitDown writes. Using the static `event` row's event_day here would
// silently miss every booth race because the row is set once at install
// and never auto-rotates.
//
// Selection priority:
//   1. Any active race for today (status in waiting/pending/running),
//      ordered by starts_at desc (the moment both lanes filled) and
//      created_at desc as a tiebreaker. This is critical: a race created
//      earlier today but joined NOW must beat a race that was created
//      more recently but already finished. Sorting by created_at alone
//      would surface a stale done race instead of the active one.
//   2. Otherwise the most recently created done/aborted race — so the
//      booth lane page can show the result screen for the race that
//      just finished.
export async function boothCurrent(raceId?: string): Promise<BoothCurrentSnapshot> {
  const sb = supabaseServer();
  const today = todayString();

  if (raceId) {
    const { data: requested } = await sb
      .from('races')
      .select('*')
      .eq('id', raceId)
      .maybeSingle();
    if (requested) return expandBoothRace(requested as RaceRow);
  }

  // Pull a handful of candidate active races and pick the freshest in JS.
  // We can't `coalesce(starts_at, created_at)` in supabase-js' .order(), so
  // we do the recency math here. We also filter out zombie 'running' rows
  // whose ends_at is already past — they'd otherwise win the recency race
  // even though no one is actually typing.
  const { data: activeCandidates } = await sb
    .from('races')
    .select('*')
    .eq('event_day', today)
    .in('status', ['waiting', 'pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(10);
  const nowMs = Date.now();
  const recencyMs = (r: any) => Math.max(
    r.starts_at ? new Date(r.starts_at).getTime() : 0,
    r.created_at ? new Date(r.created_at).getTime() : 0,
  );
  const fresh = (activeCandidates || []).filter((r: any) => {
    // Drop rows that are 'running' but past their deadline by more than 30s
    // — those are zombies (finalize never landed). 30s of grace covers the
    // tiny race condition between deadline and the client-driven finalize.
    if (r.status === 'running' && r.ends_at) {
      return new Date(r.ends_at).getTime() > nowMs - 30_000;
    }
    return true;
  });
  fresh.sort((a: any, b: any) => recencyMs(b) - recencyMs(a));
  let race: RaceRow | null = (fresh[0] as RaceRow) || null;
  if (!race) {
    const { data: done } = await sb
      .from('races')
      .select('*')
      .eq('event_day', today)
      .order('created_at', { ascending: false })
      .limit(1);
    race = (done?.[0] as RaceRow) || null;
  }
  return expandBoothRace(race);
}

// ---------- Queue ----------
export async function enqueue(playerId: string) {
  const sb = supabaseServer();
  const ev = await getEvent();
  const { data: rows } = await sb
    .from('queue')
    .select('position')
    .eq('event_day', ev.event_day)
    .order('position', { ascending: false })
    .limit(1);
  const maxPos = rows?.[0]?.position || 0;
  const id = nanoid(10);
  await sb.from('queue').insert({
    id,
    event_day: ev.event_day,
    player_id: playerId,
    position: maxPos + 1,
    status: 'waiting',
  });
  return { id, position: maxPos + 1 };
}

export async function listQueue() {
  const sb = supabaseServer();
  const ev = await getEvent();
  const { data: q } = await sb
    .from('queue')
    .select('*')
    .eq('event_day', ev.event_day)
    .order('position');
  if (!q || q.length === 0) return [];
  const ids = Array.from(new Set(q.map((r: any) => r.player_id)));
  const { data: players } = await sb.from('players').select('*').in('id', ids);
  const byId = new Map((players || []).map((p: any) => [p.id, p]));
  return q.map((r: any) => ({
    ...r,
    name: byId.get(r.player_id)?.name || '',
    title: byId.get(r.player_id)?.title || null,
    company: byId.get(r.player_id)?.company || null,
  }));
}

export async function markQueue(id: string, status: string) {
  const sb = supabaseServer();
  await sb.from('queue').update({ status }).eq('id', id);
}

// ---------- Race lifecycle ----------

// Returns the latest non-final race for today (running/pending/aborted/done).
async function latestRace(): Promise<RaceRow | null> {
  const sb = supabaseServer();
  const ev = await getEvent();
  const { data } = await sb
    .from('races')
    .select('*')
    .eq('event_day', ev.event_day)
    .order('created_at', { ascending: false })
    .limit(1);
  return (data?.[0] as RaceRow) || null;
}

export async function startRace(args: {
  p1: { id?: string; name?: string; title?: string; company?: string };
  p2: { id?: string; name?: string; title?: string; company?: string };
  durationS?: number;
  passageId?: string;
}) {
  const sb = supabaseServer();
  const ev = await getEvent();
  if (ev.status !== 'running') throw new Error('event_not_running');

  // Reject if another race is still pending/running.
  const last = await latestRace();
  if (last && (last.status === 'pending' || last.status === 'running')) {
    // If the race's ends_at has passed, quietly finalize it first.
    if (last.ends_at && new Date(last.ends_at).getTime() < Date.now()) {
      await finalizeRace(last.id);
    } else {
      throw new Error('race_in_progress');
    }
  }

  const p1 = args.p1.id ? await getPlayer(args.p1.id) : await upsertPlayer(args.p1 as any);
  const p2 = args.p2.id ? await getPlayer(args.p2.id) : await upsertPlayer(args.p2 as any);
  if (!p1 || !p2) throw new Error('player_not_found');
  if (p1.id === p2.id) throw new Error('duplicate_player');

  const passage = args.passageId ? getPassage(args.passageId) : randomQualifyingPassage();
  const durationS = args.durationS || 60;
  const now = Date.now();
  const id = nanoid(10);
  const { data, error } = await sb
    .from('races')
    .insert({
      id,
      event_day: ev.event_day,
      p1_id: p1.id,
      p2_id: p2.id,
      passage_id: passage.id,
      duration_s: durationS,
      countdown_started_at: new Date(now).toISOString(),
      starts_at: new Date(now + COUNTDOWN_MS).toISOString(),
      ends_at: new Date(now + COUNTDOWN_MS + durationS * 1000).toISOString(),
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data as RaceRow;
}

// Submit text for one lane. Three input shapes:
//   - Single passage (legacy):  { typed, elapsedMs }
//   - Multi-passage (booth):    { segments: [{passageId, typed, elapsedMs}, ...] }
// Two modes (orthogonal to shape):
//   - Live (final=false): writes text + elapsed only. Booth client uses this
//     every 300ms so spectators see live typing without finalizing.
//   - Final (final=true, default): also stamps submitted_at; if BOTH lanes
//     have a non-null submitted_at, the race finalizes immediately.
//
// When `segments` is provided, the encoded JSON goes into p{lane}_text with a
// `__SEG__` prefix; finalizeRace decodes and aggregates across them.
export async function submitTyped(args: {
  raceId: string;
  lane: 'p1' | 'p2';
  typed?: string;
  elapsedMs?: number;
  segments?: RaceSegment[];
  final?: boolean;
}) {
  const isFinal = args.final !== false;
  const sb = supabaseServer();
  const { data: race } = await sb
    .from('races')
    .select('*')
    .eq('id', args.raceId)
    .maybeSingle();
  if (!race) return { ok: false, reason: 'no_race' };
  if (race.status === 'done' || race.status === 'aborted')
    return { ok: false, reason: 'finished' };

  const patch: any = {};
  const cap = race.duration_s * 1000;

  if (Array.isArray(args.segments)) {
    const clean: RaceSegment[] = args.segments.map((s) => ({
      passageId: String(s.passageId || ''),
      typed: String(s.typed ?? ''),
      elapsedMs: Math.max(0, Math.min(Number(s.elapsedMs) || 0, cap)),
    }));
    const totalElapsed = Math.min(cap, clean.reduce((a, s) => a + s.elapsedMs, 0));
    if (args.lane === 'p1') {
      patch.p1_text = encodeRaceSegments(clean);
      patch.p1_elapsed_ms = totalElapsed;
      if (isFinal) patch.p1_submitted_at = new Date().toISOString();
    } else {
      patch.p2_text = encodeRaceSegments(clean);
      patch.p2_elapsed_ms = totalElapsed;
      if (isFinal) patch.p2_submitted_at = new Date().toISOString();
    }
  } else {
    if (args.lane === 'p1') {
      patch.p1_text = String(args.typed ?? '');
      patch.p1_elapsed_ms = Math.max(0, Math.min(Number(args.elapsedMs) || 0, cap));
      if (isFinal) patch.p1_submitted_at = new Date().toISOString();
    } else {
      patch.p2_text = String(args.typed ?? '');
      patch.p2_elapsed_ms = Math.max(0, Math.min(Number(args.elapsedMs) || 0, cap));
      if (isFinal) patch.p2_submitted_at = new Date().toISOString();
    }
  }
  await sb.from('races').update(patch).eq('id', args.raceId);

  if (!isFinal) return { ok: true };

  // Final-submit path: re-fetch and finalize if both lanes have submitted.
  const { data: updated } = await sb.from('races').select('*').eq('id', args.raceId).single();
  if (updated && updated.p1_submitted_at && updated.p2_submitted_at) {
    await finalizeRace(args.raceId);
  }
  return { ok: true };
}

export async function finalizeRace(raceId: string) {
  const sb = supabaseServer();
  const { data: race } = await sb.from('races').select('*').eq('id', raceId).maybeSingle();
  if (!race) return null;
  if (race.status === 'done' || race.status === 'aborted') return race;

  const passage = getPassage(race.passage_id);
  const durationS = race.duration_s;
  const endCapMs = durationS * 1000;

  // Aggregate one lane: handles both legacy single-passage text and the new
  // multi-passage segments encoding. Returns the same shape as classifyAndScore.
  function scoreLane(text: string | null, elapsedMs: number) {
    const segs = decodeRaceSegments(text);
    if (!segs || segs.length === 0) {
      return classifyAndScore({
        target: passage.text,
        typed: text || '',
        elapsedMs,
        durationS,
      });
    }
    let totalCorrect = 0;
    let totalTyped = 0;
    const errors: Record<string, number> = { case_mismatch: 0, transposition: 0, duplicate: 0, other: 0 };
    for (const seg of segs) {
      const target = getPassage(seg.passageId).text;
      const r = classifyAndScore({ target, typed: seg.typed || '', elapsedMs: seg.elapsedMs, durationS });
      totalCorrect += r.correctChars;
      totalTyped += r.typedLen;
      for (const k of Object.keys(errors)) errors[k] += (r.errors as any)[k] || 0;
    }
    // Booth races are fixed-window runs. Aggregate WPM must include idle time
    // until the deadline so stopping after one fast passage does not inflate
    // the score.
    const totalMs = endCapMs;
    const wpm = Math.round(((totalCorrect / 5) / (totalMs / 60000)) * 10) / 10;
    const acc = Math.round((totalCorrect / Math.max(1, totalTyped)) * 1000) / 10;
    const score = Math.round(wpm * Math.pow(acc / 100, 2) * 10 * 10) / 10;
    return { wpm, acc, score, correctChars: totalCorrect, typedLen: totalTyped, elapsedMs: totalMs, errors };
  }

  const s1 = {
    typed: race.p1_text || '',
    elapsedMs: race.p1_elapsed_ms ?? endCapMs,
    at: race.p1_submitted_at ? Date.parse(race.p1_submitted_at) : Date.now(),
  };
  const s2 = {
    typed: race.p2_text || '',
    elapsedMs: race.p2_elapsed_ms ?? endCapMs,
    at: race.p2_submitted_at ? Date.parse(race.p2_submitted_at) : Date.now(),
  };

  const r1 = scoreLane(s1.typed, s1.elapsedMs);
  const r2 = scoreLane(s2.typed, s2.elapsedMs);
  const endedAt = Date.now();
  const w = determineWinner(
    { score: r1.score, acc: r1.acc, correctChars: r1.correctChars, endedAt: s1.at || endedAt },
    { score: r2.score, acc: r2.acc, correctChars: r2.correctChars, endedAt: s2.at || endedAt }
  );
  const winner_id = w === 'a' ? race.p1_id : w === 'b' ? race.p2_id : null;

  const { data, error } = await sb
    .from('races')
    .update({
      status: 'done',
      ended_at: new Date(endedAt).toISOString(),
      p1_score: r1.score, p2_score: r2.score,
      p1_wpm: r1.wpm, p2_wpm: r2.wpm,
      p1_acc: r1.acc, p2_acc: r2.acc,
      p1_errors: r1.errors, p2_errors: r2.errors,
      winner_id,
    })
    .eq('id', raceId)
    .eq('status', race.status) // optimistic: skip if someone else finalized
    .select()
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || race;
}

export async function abortRace(raceId: string, reason = 'aborted') {
  const sb = supabaseServer();
  await sb
    .from('races')
    .update({ status: 'aborted', ended_at: new Date().toISOString() })
    .eq('id', raceId);
}

// ---------- Leaderboard ----------
// Aggregates best score per player across head-to-head races AND solo runs.
// scope='today' (default) keeps the per-day competitive board for the booth
// based on today's real UTC calendar date; scope='all' folds in every
// event_day for the cross-conference cumulative view.
export async function leaderboard(
  limit = 20,
  scope: 'today' | 'all' = 'today',
): Promise<LBEntry[]> {
  const sb = supabaseServer();
  const racesQ = sb.from('races')
    .select('p1_id,p2_id,p1_score,p2_score,p1_acc,p2_acc,ended_at,event_day,status')
    .eq('status', 'done');
  // Qualifying leaderboard excludes Day-Finals event runs — those have
  // their own per-day board on the landing page's "Day finals" tab. NOT
  // (is_event_run = true) matches both `false` and any legacy NULL rows
  // from before the column existed.
  const solosQ = sb.from('solo_runs')
    .select('player_id,score,acc,ended_at,event_day,status,is_event_run')
    .eq('status', 'done')
    .not('is_event_run', 'eq', true);
  if (scope === 'today') {
    const today = todayString();
    racesQ.eq('event_day', today);
    solosQ.eq('event_day', today);
  }
  const [{ data: races }, { data: solos }] = await Promise.all([racesQ, solosQ]);

  const best = new Map<string, { score: number; acc: number; at: string }>();
  const consider = (pid: string | null | undefined, sc: number | null | undefined, ac: number | null | undefined, at: string | null | undefined) => {
    if (!pid || sc == null) return;
    const cur = best.get(pid);
    if (
      !cur ||
      sc > cur.score ||
      (sc === cur.score && (ac || 0) > cur.acc) ||
      (sc === cur.score && (ac || 0) === cur.acc && (at || '') < cur.at)
    ) {
      best.set(pid, { score: sc, acc: ac || 0, at: at || '' });
    }
  };
  for (const r of races || []) {
    consider(r.p1_id, r.p1_score, r.p1_acc, r.ended_at);
    consider(r.p2_id, r.p2_score, r.p2_acc, r.ended_at);
  }
  for (const s of solos || []) {
    consider(s.player_id, s.score, s.acc, s.ended_at);
  }

  if (best.size === 0) return [];
  const ids = Array.from(best.keys());
  const { data: players } = await sb.from('players').select('*').in('id', ids);
  const byId = new Map((players || []).map((p: any) => [p.id, p]));
  const rows: LBEntry[] = ids
    .map((pid) => {
      const b = best.get(pid)!;
      const p: any = byId.get(pid);
      if (!p) return null;
      // No post-aggregation event_day filter on the player row: race-level
      // filtering above already restricts to the right day, and a returning
      // player's player.event_day reflects when they FIRST played, which we
      // shouldn't use to gate today's leaderboard.
      return {
        player_id: pid,
        name: p.name,
        title: p.title,
        company: p.company,
        best_score: b.score,
        best_acc: b.acc,
        best_at: b.at,
      } as LBEntry;
    })
    .filter(Boolean) as LBEntry[];
  rows.sort(
    (a, b) =>
      b.best_score - a.best_score ||
      b.best_acc - a.best_acc ||
      (a.best_at > b.best_at ? 1 : -1)
  );
  return rows.slice(0, limit);
}

export async function top5() {
  return (await leaderboard(5));
}

// ---------- Final round ----------
export async function lockFinal(opts?: { isCeo?: boolean; ceoPlayerIds?: string[] }) {
  const sb = supabaseServer();
  const ev = await getEvent();
  const isCeo = !!opts?.isCeo;
  let order: string[];
  if (isCeo) {
    if (!opts?.ceoPlayerIds?.length) throw new Error('ceo_players_required');
    order = [...opts.ceoPlayerIds];
  } else {
    const qualifiers = await top5();
    if (qualifiers.length < 2) throw new Error('not_enough_qualifiers');
    order = qualifiers.map((q) => q.player_id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }

  const { data, error } = await sb
    .from('final')
    .insert({
      event_day: ev.event_day,
      state: 'locked',
      passage_id: 'p2',
      duration_s: 60,
      order_json: order,
      current_index: 0,
      is_ceo: isCeo,
    })
    .select()
    .single();
  if (error) throw error;
  if (!isCeo) await setEventStatus('final_locked');
  return data;
}

export async function currentFinal() {
  const sb = supabaseServer();
  const ev = await getEvent();
  const { data } = await sb
    .from('final')
    .select('*')
    .eq('event_day', ev.event_day)
    .eq('is_ceo', false)
    .order('id', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

export async function currentCeoFinal() {
  const sb = supabaseServer();
  const ev = await getEvent();
  const { data } = await sb
    .from('final')
    .select('*')
    .eq('event_day', ev.event_day)
    .eq('is_ceo', true)
    .order('id', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

export async function startFinalRun(finalId: number) {
  const sb = supabaseServer();
  const { data: f } = await sb.from('final').select('*').eq('id', finalId).maybeSingle();
  if (!f) throw new Error('final_not_found');
  if (f.state === 'done') throw new Error('final_done');
  const playerId = f.order_json[f.current_index];
  if (!playerId) throw new Error('no_finalist_at_index');
  if (f.current_status === 'pending' && f.current_ends_at && Date.parse(f.current_ends_at) > Date.now()) {
    throw new Error('final_run_in_progress');
  }
  const durationS = f.duration_s;
  const now = Date.now();
  const patch: any = {
    state: 'running',
    started_at: f.started_at || new Date(now).toISOString(),
    current_player_id: playerId,
    current_countdown_started_at: new Date(now).toISOString(),
    current_starts_at: new Date(now + COUNTDOWN_MS).toISOString(),
    current_ends_at: new Date(now + COUNTDOWN_MS + durationS * 1000).toISOString(),
    current_text: null,
    current_elapsed_ms: null,
    current_submitted_at: null,
    current_status: 'pending',
  };
  const { data, error } = await sb.from('final').update(patch).eq('id', finalId).select().single();
  if (error) throw error;
  if (!f.is_ceo) await setEventStatus('final_running');
  return data;
}

export async function submitFinalTyped(args: { finalId: number; typed: string; elapsedMs: number }) {
  const sb = supabaseServer();
  const { data: f } = await sb.from('final').select('*').eq('id', args.finalId).maybeSingle();
  if (!f || f.current_status !== 'pending') return { ok: false, reason: 'no_active_run' };
  await sb
    .from('final')
    .update({
      current_text: String(args.typed ?? ''),
      current_elapsed_ms: Math.max(0, Math.min(args.elapsedMs, f.duration_s * 1000)),
      current_submitted_at: new Date().toISOString(),
    })
    .eq('id', args.finalId);
  await finalizeFinalRun(args.finalId);
  return { ok: true };
}

export async function finalizeFinalRun(finalId: number) {
  const sb = supabaseServer();
  const { data: f } = await sb.from('final').select('*').eq('id', finalId).maybeSingle();
  if (!f || f.current_status !== 'pending') return null;
  const passage = getPassage(f.passage_id);
  const durationS = f.duration_s;
  const typed = f.current_text || '';
  const elapsedMs = f.current_elapsed_ms ?? durationS * 1000;
  const r = classifyAndScore({ target: passage.text, typed, elapsedMs, durationS });

  await sb.from('final_runs').insert({
    id: nanoid(10),
    final_id: finalId,
    player_id: f.current_player_id,
    score: r.score,
    wpm: r.wpm,
    acc: r.acc,
    text: typed,
    errors: r.errors,
  });

  const nextIdx = f.current_index + 1;
  const isDone = nextIdx >= f.order_json.length;
  await sb
    .from('final')
    .update({
      current_index: nextIdx,
      state: isDone ? 'done' : 'locked',
      ended_at: isDone ? new Date().toISOString() : null,
      current_player_id: null,
      current_countdown_started_at: null,
      current_starts_at: null,
      current_ends_at: null,
      current_text: null,
      current_elapsed_ms: null,
      current_submitted_at: null,
      current_status: 'done',
    })
    .eq('id', finalId);
  if (isDone && !f.is_ceo) await setEventStatus('final_done');
  return f;
}

async function expandFinal(f: FinalRow | null) {
  if (!f) return null;
  const sb = supabaseServer();
  const { data: runs } = await sb
    .from('final_runs')
    .select('*')
    .eq('final_id', f.id)
    .order('completed_at');
  const ids = f.order_json;
  const { data: players } = await sb.from('players').select('*').in('id', ids);
  const byId = new Map((players || []).map((p: any) => [p.id, p]));
  const runsBy = new Map((runs || []).map((r: any) => [r.player_id, r]));
  return {
    ...f,
    players: ids.map((pid) => {
      const p: any = byId.get(pid);
      return {
        id: pid,
        name: p?.name || '(unknown)',
        company: p?.company || null,
        run: runsBy.get(pid) || null,
      };
    }),
  };
}

// ---------- Full app-state snapshot ----------
export async function appState(): Promise<AppState> {
  const ev = await getEvent();
  const [lb, queueRows, finalRow, ceoRow, lastRace] = await Promise.all([
    leaderboard(20),
    listQueue(),
    currentFinal(),
    currentCeoFinal(),
    latestRace(),
  ]);

  let live: any = null;
  // Prefer the active final run if one is pending.
  const activeFinal = [finalRow, ceoRow].find((f: any) => f?.current_status === 'pending');
  if (activeFinal) {
    const passage = getPassage((activeFinal as any).passage_id);
    const playerId = (activeFinal as any).current_player_id;
    const pl = playerId ? await getPlayer(playerId) : null;
    live = {
      kind: 'final',
      ...(activeFinal as any),
      passageText: passage.text,
      playerName: pl?.name || '',
    };
  } else if (
    lastRace &&
    (lastRace.status === 'pending' ||
      lastRace.status === 'running' ||
      // Show "just finished" race for a few seconds on the results screen.
      (lastRace.status === 'done' &&
        lastRace.ended_at &&
        Date.now() - Date.parse(lastRace.ended_at) < 30000))
  ) {
    const passage = getPassage(lastRace.passage_id);
    const [p1, p2] = await Promise.all([getPlayer(lastRace.p1_id), getPlayer(lastRace.p2_id)]);
    live = {
      kind: 'race',
      ...lastRace,
      passageText: passage.text,
      p1Name: p1?.name || '',
      p2Name: p2?.name || '',
    };
  }

  return {
    event: { event_day: ev.event_day, status: ev.status },
    live,
    leaderboard: lb,
    top5: lb.slice(0, 5),
    queue: queueRows,
    final: (await expandFinal(finalRow as any)) as any,
    ceoFinal: await expandFinal(ceoRow as any),
    passages: PASSAGES.map((p) => ({ id: p.id, kind: p.kind, length: p.text.length })),
    serverTime: Date.now(),
  };
}

// ---------- CSV export ----------
export async function exportCsv() {
  const ev = await getEvent();
  const lb = await leaderboard(1000);
  const f = (await expandFinal((await currentFinal()) as any)) as any;
  const c = (await expandFinal((await currentCeoFinal()) as any)) as any;
  const lines = ['section,rank,name,company,score,acc'];
  lb.forEach((r, i) => {
    lines.push(`leaderboard,${i + 1},"${csv(r.name)}","${csv(r.company || '')}",${r.best_score},${r.best_acc}`);
  });
  if (f) {
    const ranked = f.players.filter((p: any) => p.run).sort((a: any, b: any) => b.run.score - a.run.score);
    ranked.forEach((p: any, i: number) => {
      lines.push(`final,${i + 1},"${csv(p.name)}","${csv(p.company || '')}",${p.run.score},${p.run.acc}`);
    });
  }
  if (c) {
    const ranked = c.players.filter((p: any) => p.run).sort((a: any, b: any) => b.run.score - a.run.score);
    ranked.forEach((p: any, i: number) => {
      lines.push(`ceo,${i + 1},"${csv(p.name)}","${csv(p.company || '')}",${p.run.score},${p.run.acc}`);
    });
  }
  return { event_day: ev.event_day, csv: lines.join('\n') };
}
function csv(s: string) {
  return String(s || '').replace(/"/g, '""');
}

// ---------- Space-themed name generator ----------
const SPACE_ADJ = [
  'Stellar', 'Cosmic', 'Nebula', 'Galactic', 'Lunar', 'Solar', 'Astro',
  'Orbital', 'Quantum', 'Photon', 'Pulsar', 'Cometary', 'Meteoric', 'Celestial',
  'Interstellar', 'Gravity', 'Plasma', 'Ion', 'Vortex', 'Warp', 'Hyper', 'Deep',
];
const SPACE_NOUN = [
  'Racer', 'Typist', 'Pilot', 'Navigator', 'Ranger', 'Runner', 'Rider',
  'Scout', 'Captain', 'Commander', 'Explorer', 'Voyager', 'Traveler',
  'Wanderer', 'Seeker', 'Courier', 'Maverick', 'Specter', 'Drifter',
];
function randomSpaceName() {
  const a = SPACE_ADJ[Math.floor(Math.random() * SPACE_ADJ.length)];
  const n = SPACE_NOUN[Math.floor(Math.random() * SPACE_NOUN.length)];
  return `${a} ${n}`;
}

// Create a player with a generated name, retrying with a numeric suffix on
// unique-constraint collisions. Used by /play ("just type") mode.
async function createAnonymousPlayer(): Promise<any> {
  const sb = supabaseServer();
  const ev = await getEvent();
  for (let attempt = 0; attempt < 8; attempt++) {
    const base = randomSpaceName();
    const name = attempt === 0 ? base : `${base} ${Math.floor(Math.random() * 900 + 100)}`;
    const id = nanoid(10);
    const { data, error } = await sb
      .from('players')
      .insert({ id, name, title: '', company: '', event_day: ev.event_day })
      .select()
      .single();
    if (!error) return data;
    if (error.code !== '23505') throw error; // not a duplicate
  }
  throw new Error('could_not_generate_unique_name');
}

// Rename a player. If the new name collides, append " #2", " #3", ... until it sticks.
export async function renamePlayer(playerId: string, newName: string) {
  const sb = supabaseServer();
  const trimmed = (newName || '').trim().slice(0, 40);
  if (!trimmed) throw new Error('name_required');
  let candidate = trimmed;
  for (let i = 2; i < 20; i++) {
    const { data, error } = await sb
      .from('players')
      .update({ name: candidate })
      .eq('id', playerId)
      .select()
      .single();
    if (!error) return data;
    if (error.code !== '23505') throw error;
    candidate = `${trimmed} #${i}`;
  }
  throw new Error('name_collision_limit');
}

// ---------- Solo runs ("Play" mode) ----------

export async function startSoloRun(args: {
  player: { id?: string; name?: string; title?: string; company?: string };
  durationS?: number;
  passageId?: string;
}) {
  const sb = supabaseServer();
  const ev = await getEvent();
  // If no id and no explicit name, generate a space-themed anonymous player.
  let player;
  if (args.player.id) {
    player = await getPlayer(args.player.id);
  } else if (args.player.name && args.player.name.trim()) {
    player = await upsertPlayer(args.player as any);
  } else {
    player = await createAnonymousPlayer();
  }
  if (!player) throw new Error('player_not_found');
  const passage = args.passageId ? getPassage(args.passageId) : randomQualifyingPassage();
  const durationS = args.durationS || 60;
  const now = Date.now();
  const id = nanoid(10);
  const { data, error } = await sb
    .from('solo_runs')
    .insert({
      id,
      event_day: ev.event_day,
      player_id: player.id,
      passage_id: passage.id,
      duration_s: durationS,
      countdown_started_at: new Date(now).toISOString(),
      starts_at: new Date(now + COUNTDOWN_MS).toISOString(),
      ends_at: new Date(now + COUNTDOWN_MS + durationS * 1000).toISOString(),
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return { run: data, player };
}

// A segment is one passage attempt within a run:
//   { passageId: string, typed: string, elapsedMs: number }
// Multiple segments compose a single solo run — each time a player completes
// a passage they roll over into the next one and the previous one becomes a
// completed segment.
//
// Storage: segments are JSON-encoded into the `typed` TEXT column with a
// `__SEG__` prefix. This avoids depending on a jsonb column that may or may
// not exist in the user's Supabase project. finalizeSoloRun decodes it back.
type Segment = { passageId: string; typed: string; elapsedMs: number };

const SEG_PREFIX = '__SEG__';
function encodeSegments(segs: Segment[]): string {
  return SEG_PREFIX + JSON.stringify(segs);
}
function decodeSegments(s: string | null | undefined): Segment[] | null {
  if (!s || !s.startsWith(SEG_PREFIX)) return null;
  try {
    const parsed = JSON.parse(s.slice(SEG_PREFIX.length));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function submitSoloTyped(args: {
  runId: string; typed?: string; elapsedMs?: number; segments?: Segment[];
}) {
  const sb = supabaseServer();
  const { data: run } = await sb.from('solo_runs').select('*').eq('id', args.runId).maybeSingle();
  if (!run) return { ok: false, reason: 'no_run' };
  if (run.status !== 'pending') return { ok: false, reason: 'finished' };

  const patch: any = { submitted_at: new Date().toISOString() };
  if (Array.isArray(args.segments)) {
    const clean: Segment[] = args.segments.map((s) => ({
      passageId: String(s.passageId || ''),
      typed: String(s.typed ?? ''),
      elapsedMs: Math.max(0, Math.min(Number(s.elapsedMs) || 0, run.duration_s * 1000)),
    }));
    patch.typed = encodeSegments(clean);
    patch.elapsed_ms = Math.min(
      run.duration_s * 1000,
      clean.reduce((a, s) => a + s.elapsedMs, 0)
    );
  } else {
    patch.typed = String(args.typed ?? '');
    patch.elapsed_ms = Math.max(0, Math.min(Number(args.elapsedMs) || 0, run.duration_s * 1000));
  }
  const { error } = await sb.from('solo_runs').update(patch).eq('id', args.runId);
  if (error) {
    // Surface the error rather than silently failing (which is what caused
    // the "score is 0" bug earlier).
    console.error('[solo submit] update failed:', error);
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

export async function finalizeSoloRun(runId: string) {
  const sb = supabaseServer();
  const { data: run } = await sb.from('solo_runs').select('*').eq('id', runId).maybeSingle();
  if (!run) return null;
  if (run.status === 'done' || run.status === 'aborted') return run;

  const durationS = run.duration_s;

  let score = 0, wpm = 0, acc = 0;
  let totalErrors: Record<string, number> = { case_mismatch: 0, transposition: 0, duplicate: 0, other: 0 };
  let totalCorrect = 0, totalTyped = 0;

  // Resolve segments from either the encoded `typed` field (new) or the
  // legacy jsonb `segments` column if someone happens to have it populated.
  let segments: Segment[] = decodeSegments(run.typed) || [];
  if (segments.length === 0 && Array.isArray(run.segments)) {
    segments = run.segments;
  }

  if (segments.length > 0) {
    for (const seg of segments) {
      const passage = getPassage(seg.passageId);
      const r = classifyAndScore({
        target: passage.text,
        typed: seg.typed || '',
        elapsedMs: seg.elapsedMs,
        durationS,
      });
      totalCorrect += r.correctChars;
      totalTyped += r.typedLen;
      for (const k of Object.keys(totalErrors)) totalErrors[k] += (r.errors as any)[k] || 0;
    }
    // Solo/event runs are fixed-window runs; count the whole window, not just
    // active completed segment time, so idle time after typing lowers WPM.
    const totalMs = durationS * 1000;
    wpm = Math.round(((totalCorrect / 5) / (totalMs / 60000)) * 10) / 10;
    acc = Math.round((totalCorrect / Math.max(1, totalTyped)) * 1000) / 10;
    score = Math.round(wpm * Math.pow(acc / 100, 2) * 10 * 10) / 10;
  } else {
    // Legacy single-passage path: `typed` is plain text against run.passage_id.
    const passage = getPassage(run.passage_id);
    const typed = run.typed || '';
    const elapsedMs = run.elapsed_ms ?? durationS * 1000;
    const r = classifyAndScore({ target: passage.text, typed, elapsedMs, durationS });
    score = r.score; wpm = r.wpm; acc = r.acc; totalErrors = r.errors;
  }

  const { data, error } = await sb
    .from('solo_runs')
    .update({
      status: 'done',
      ended_at: new Date().toISOString(),
      score, wpm, acc,
      errors: totalErrors,
    })
    .eq('id', runId)
    .eq('status', 'pending')
    .select()
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('[solo finalize] update failed:', error);
  }
  return data || run;
}

export async function getSoloRun(runId: string) {
  const sb = supabaseServer();
  const { data } = await sb.from('solo_runs').select('*').eq('id', runId).maybeSingle();
  return data;
}

// ---------- Day-end Final Event ----------
// Stored in the same `solo_runs` table but tagged with is_event_run=true so
// the per-day event leaderboard can filter for them. All finalists on a given
// day type the SAME passage sequence (deterministic by today's UTC date via
// pickFinalsPassageIds). Submission + finalization reuse submitSoloTyped /
// finalizeSoloRun — they already handle segment encoding, and getPassage
// resolves both booth and finals passage IDs.

export type EventLBEntry = {
  player_id: string;
  name: string;
  title: string | null;
  company: string | null;
  score: number;
  wpm: number;
  acc: number;
  ended_at: string | null;
};

// Phone-only entry for the Day-Finals event. The finalist enters their
// phone number; we look up their existing player row (which must exist
// from booth play earlier in the day), verify they're in today's top 20
// qualifying leaderboard, and only then create the event run. Their stored
// name/title/company carry over — we don't re-ask for them.
//
// Throws:
//   'phone_invalid'      — phone normalizer rejected
//   'player_not_found'   — phone has never played at the booth
//   'not_eligible'       — player isn't in today's top 20 qualifying
//   'event_not_open'     — it's before 5pm Pacific (event hasn't opened)
//   'event_not_running'  — the booth event itself is paused
export async function startEventRun(input: {
  phone: string;
}): Promise<{
  run: any;
  player: any;
  passages: { id: string; text: string }[];
}> {
  // Day-end Final Event opens at 5pm Pacific. We enforce server-side too so
  // a clever user can't bypass the client-side gate by hitting /api/event/start
  // directly.
  if (!isEventOpenNow()) throw new Error('event_not_open');
  const ev = await getEvent();
  if (ev.status !== 'running') throw new Error('event_not_running');
  const today = todayString();

  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error('phone_invalid');

  const sb = supabaseServer();
  const { data: existing, error: lookupErr } = await sb
    .from('players')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!existing) throw new Error('player_not_found');

  // Eligibility: must be in today's top 20 qualifying leaderboard. We re-use
  // the existing leaderboard() helper (already filters out is_event_run=true
  // and scopes to today's UTC date).
  const top20 = await leaderboard(20, 'today');
  const eligible = top20.some((row) => row.player_id === existing.id);
  if (!eligible) throw new Error('not_eligible');

  const passageIds = pickFinalsPassageIds(today);
  const passages = passageIds.map((pid) => {
    const p = getFinalsPassage(pid);
    return { id: p.id, text: p.text };
  });

  const durationS = 60;
  const now = Date.now();
  const id = nanoid(10);
  const { data, error } = await sb
    .from('solo_runs')
    .insert({
      id,
      event_day: today,
      player_id: existing.id,
      passage_id: passageIds[0],
      duration_s: durationS,
      countdown_started_at: new Date(now).toISOString(),
      starts_at: new Date(now + COUNTDOWN_MS).toISOString(),
      ends_at: new Date(now + COUNTDOWN_MS + durationS * 1000).toISOString(),
      status: 'pending',
      is_event_run: true,
    })
    .select()
    .single();
  if (error) throw error;
  return { run: data, player: existing, passages };
}

// Per-day event leaderboard. Defaults to today; pass a YYYY-MM-DD string for
// a historical day. Returns each player's BEST event run for that day,
// ranked by score (no tiebreaker per the design spec).
export async function eventLeaderboard(day?: string): Promise<EventLBEntry[]> {
  const sb = supabaseServer();
  const target = day || todayString();
  const { data: runs } = await sb
    .from('solo_runs')
    .select('player_id, score, wpm, acc, ended_at, status, is_event_run, event_day')
    .eq('event_day', target)
    .eq('is_event_run', true)
    .eq('status', 'done');

  if (!runs || runs.length === 0) return [];

  // Best event run per player (in case someone played the event twice).
  const best = new Map<string, any>();
  for (const r of runs as any[]) {
    if (!r.player_id) continue;
    const cur = best.get(r.player_id);
    if (!cur || Number(r.score ?? 0) > Number(cur.score ?? 0)) {
      best.set(r.player_id, r);
    }
  }

  const ids = Array.from(best.keys());
  const { data: players } = await sb.from('players').select('*').in('id', ids);
  const byId = new Map((players || []).map((p: any) => [p.id, p]));
  const rows: EventLBEntry[] = Array.from(best.values()).map((r: any) => {
    const p: any = byId.get(r.player_id);
    return {
      player_id: r.player_id,
      name: p?.name || '(unknown)',
      title: p?.title || null,
      company: p?.company || null,
      score: Number(r.score ?? 0),
      wpm: Number(r.wpm ?? 0),
      acc: Number(r.acc ?? 0),
      ended_at: r.ended_at,
    };
  });
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

// Returns the list of distinct event_day values that have at least one
// completed event run. Used by the landing-page "Day Finals" tab to render
// historical day pickers.
export async function eventDays(): Promise<string[]> {
  const sb = supabaseServer();
  const { data } = await sb
    .from('solo_runs')
    .select('event_day')
    .eq('is_event_run', true)
    .eq('status', 'done')
    .order('event_day', { ascending: false });
  if (!data) return [];
  const seen = new Set<string>();
  for (const r of data as any[]) {
    if (r.event_day) seen.add(r.event_day);
  }
  return Array.from(seen);
}

// ---------- Head-to-head rooms ----------
// Instant 1v1: a room row holds all the state for both lanes + timing.
// The three shared URLs are: /h2h/<id> (spectator), /h2h/<id>/1, /h2h/<id>/2.

type Lane = '1' | '2';

export async function createRoom(opts?: { passageId?: string; durationS?: number }) {
  const sb = supabaseServer();
  const passage = opts?.passageId ? getPassage(opts.passageId) : randomQualifyingPassage();
  const id = nanoid(8).toLowerCase();
  const { data, error } = await sb
    .from('h2h_rooms')
    .insert({
      id,
      passage_id: passage.id,
      duration_s: opts?.durationS || 60,
      status: 'waiting',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getRoom(id: string) {
  const sb = supabaseServer();
  const { data } = await sb.from('h2h_rooms').select('*').eq('id', id).maybeSingle();
  return data;
}

export async function joinRoom(args: { id: string; lane: Lane; name: string }) {
  const sb = supabaseServer();
  const name = (args.name || '').trim().slice(0, 40);
  if (!name) throw new Error('name_required');
  const patch: any = { [`p${args.lane}_name`]: name, [`p${args.lane}_joined_at`]: new Date().toISOString() };
  // Flip to 'ready' once both players are named.
  const { data: current } = await sb.from('h2h_rooms').select('*').eq('id', args.id).maybeSingle();
  if (!current) throw new Error('room_not_found');
  if (current.status !== 'waiting' && current.status !== 'ready') throw new Error('room_not_joinable');
  const otherName = args.lane === '1' ? current.p2_name : current.p1_name;
  if (otherName) patch.status = 'ready';
  const { data, error } = await sb.from('h2h_rooms').update(patch).eq('id', args.id).select().single();
  if (error) throw error;
  // Idempotent recompute: if both lanes are now named but status didn't get
  // flipped (e.g. concurrent joins where each read saw the other lane as
  // null), promote to 'ready' here. Without this, the lobby's Start button
  // never appears.
  if (data && data.p1_name && data.p2_name && data.status === 'waiting') {
    const { data: promoted } = await sb
      .from('h2h_rooms')
      .update({ status: 'ready' })
      .eq('id', args.id)
      .eq('status', 'waiting')
      .select()
      .single();
    return promoted || data;
  }
  return data;
}

export async function startRoom(id: string) {
  const sb = supabaseServer();
  const { data: room } = await sb.from('h2h_rooms').select('*').eq('id', id).maybeSingle();
  if (!room) throw new Error('room_not_found');
  if (!room.p1_name || !room.p2_name) throw new Error('need_two_players');
  if (room.status === 'running' || room.status === 'done') return room;

  const now = Date.now();
  const { data, error } = await sb
    .from('h2h_rooms')
    .update({
      status: 'running',
      countdown_started_at: new Date(now).toISOString(),
      starts_at: new Date(now + COUNTDOWN_MS).toISOString(),
      ends_at: new Date(now + COUNTDOWN_MS + room.duration_s * 1000).toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function roomSubmit(args: { id: string; lane: Lane; typed: string; elapsedMs: number }) {
  const sb = supabaseServer();
  const { data: room } = await sb.from('h2h_rooms').select('*').eq('id', args.id).maybeSingle();
  if (!room) return { ok: false, reason: 'no_room' };
  if (room.status === 'done') return { ok: false, reason: 'finished' };
  const patch: any = {};
  patch[`p${args.lane}_typed`] = String(args.typed ?? '');
  patch[`p${args.lane}_elapsed_ms`] = Math.max(0, Math.min(args.elapsedMs, room.duration_s * 1000));
  patch[`p${args.lane}_submitted_at`] = new Date().toISOString();
  const { error } = await sb.from('h2h_rooms').update(patch).eq('id', args.id);
  if (error) {
    console.error('[h2h submit] update failed:', error);
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

export async function finalizeRoom(id: string) {
  const sb = supabaseServer();
  const { data: room } = await sb.from('h2h_rooms').select('*').eq('id', id).maybeSingle();
  if (!room) return null;
  if (room.status === 'done') return room;

  const passage = getPassage(room.passage_id);
  const durationS = room.duration_s;
  const r1 = classifyAndScore({
    target: passage.text,
    typed: room.p1_typed || '',
    elapsedMs: room.p1_elapsed_ms ?? durationS * 1000,
    durationS,
  });
  const r2 = classifyAndScore({
    target: passage.text,
    typed: room.p2_typed || '',
    elapsedMs: room.p2_elapsed_ms ?? durationS * 1000,
    durationS,
  });
  const w = determineWinner(
    { score: r1.score, acc: r1.acc, correctChars: r1.correctChars, endedAt: Date.parse(room.p1_submitted_at || new Date().toISOString()) },
    { score: r2.score, acc: r2.acc, correctChars: r2.correctChars, endedAt: Date.parse(room.p2_submitted_at || new Date().toISOString()) }
  );
  const winner = w === 'a' ? '1' : w === 'b' ? '2' : 'tie';

  const { data } = await sb
    .from('h2h_rooms')
    .update({
      status: 'done',
      ended_at: new Date().toISOString(),
      p1_score: r1.score, p1_wpm: r1.wpm, p1_acc: r1.acc,
      p2_score: r2.score, p2_wpm: r2.wpm, p2_acc: r2.acc,
      winner,
    })
    .eq('id', id)
    .neq('status', 'done')
    .select()
    .single();
  return data || room;
}
