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
import { getPassage, randomQualifyingPassage, PASSAGES } from './passages';
import type { AppState, LBEntry, RaceRow, FinalRow, FinalRun } from './types';

const COUNTDOWN_MS = 3000;

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

// Submit text for one lane. Writes the text + elapsed_ms + submitted_at.
// If both lanes have now submitted, finalizes immediately.
export async function submitTyped(args: {
  raceId: string;
  lane: 'p1' | 'p2';
  typed: string;
  elapsedMs: number;
}) {
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
  if (args.lane === 'p1') {
    patch.p1_text = String(args.typed ?? '');
    patch.p1_elapsed_ms = Math.max(0, Math.min(args.elapsedMs, race.duration_s * 1000));
    patch.p1_submitted_at = new Date().toISOString();
  } else {
    patch.p2_text = String(args.typed ?? '');
    patch.p2_elapsed_ms = Math.max(0, Math.min(args.elapsedMs, race.duration_s * 1000));
    patch.p2_submitted_at = new Date().toISOString();
  }
  await sb.from('races').update(patch).eq('id', args.raceId);

  // Re-fetch and check for finalize conditions.
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

  const r1 = classifyAndScore({ target: passage.text, typed: s1.typed, elapsedMs: s1.elapsedMs, durationS });
  const r2 = classifyAndScore({ target: passage.text, typed: s2.typed, elapsedMs: s2.elapsedMs, durationS });
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
export async function leaderboard(limit = 20): Promise<LBEntry[]> {
  const sb = supabaseServer();
  const ev = await getEvent();
  const [{ data: races }, { data: solos }] = await Promise.all([
    sb.from('races')
      .select('p1_id,p2_id,p1_score,p2_score,p1_acc,p2_acc,ended_at,event_day,status')
      .eq('event_day', ev.event_day)
      .eq('status', 'done'),
    sb.from('solo_runs')
      .select('player_id,score,acc,ended_at,event_day,status')
      .eq('event_day', ev.event_day)
      .eq('status', 'done'),
  ]);

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
      if (!p || p.event_day !== ev.event_day) return null;
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
  let totalCorrect = 0, totalTyped = 0, totalMs = 0;

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
      totalMs += r.elapsedMs;
      for (const k of Object.keys(totalErrors)) totalErrors[k] += (r.errors as any)[k] || 0;
    }
    totalMs = Math.max(1, Math.min(totalMs, durationS * 1000));
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
