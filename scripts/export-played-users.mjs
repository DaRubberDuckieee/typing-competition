import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'reports');
const PAGE_SIZE = 1000;

await loadEnv(path.join(ROOT, '.env'));
await loadEnv(path.join(ROOT, '.env.local'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_READ_ONLY_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL and a Supabase key. Set NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_READ_ONLY_KEY.',
  );
}

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split('=');
      return [key, rest.length ? rest.join('=') : 'true'];
    }),
);
const dayFilter = args.get('day');

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [players, races, soloRuns, finalRuns, h2hRooms] = await Promise.all([
  selectAll('players', 'id,name,title,company,phone,event_day,created_at'),
  selectAll(
    'races',
    'id,event_day,p1_id,p2_id,status,created_at,starts_at,ended_at,p1_submitted_at,p2_submitted_at,p1_score,p2_score,p1_wpm,p2_wpm,p1_acc,p2_acc',
  ),
  selectAll(
    'solo_runs',
    'id,event_day,player_id,status,created_at,starts_at,ended_at,submitted_at,score,wpm,acc,is_event_run',
  ),
  selectAll(
    'final_runs',
    'id,player_id,score,wpm,acc,completed_at,final:final_id(event_day,is_ceo)',
  ),
  selectAll(
    'h2h_rooms',
    'id,status,p1_name,p2_name,p1_joined_at,p2_joined_at,p1_submitted_at,p2_submitted_at,p1_score,p2_score,p1_wpm,p2_wpm,p1_acc,p2_acc,created_at,ended_at',
  ),
]);

const playersById = new Map(players.map((player) => [player.id, player]));
const summaries = new Map();
const h2hOnlyRows = [];

for (const race of races) {
  if (dayFilter && race.event_day !== dayFilter) continue;
  const raceStarted = race.status === 'running' || race.status === 'done';
  recordRaceLane(race, 'p1', race.p1_id, raceStarted || race.p1_submitted_at || race.p1_score != null);
  recordRaceLane(race, 'p2', race.p2_id, raceStarted || race.p2_submitted_at || race.p2_score != null);
}

for (const run of soloRuns) {
  if (dayFilter && run.event_day !== dayFilter) continue;
  if (!run.player_id) continue;
  if (!(run.status === 'done' || run.submitted_at || run.score != null)) continue;
  const summary = ensureSummary(run.player_id);
  summary.solo_runs += 1;
  if (run.is_event_run) summary.event_runs += 1;
  summary.played_days.add(run.event_day || '');
  touch(summary, run.created_at, run.ended_at || run.submitted_at || run.starts_at || run.created_at);
  considerBest(summary, run.score, run.wpm, run.acc, run.ended_at || run.submitted_at || run.created_at);
}

for (const run of finalRuns) {
  const finalDay = Array.isArray(run.final) ? run.final[0]?.event_day : run.final?.event_day;
  if (dayFilter && finalDay !== dayFilter) continue;
  if (!run.player_id) continue;
  const summary = ensureSummary(run.player_id);
  summary.final_runs += 1;
  summary.played_days.add(finalDay || '');
  touch(summary, run.completed_at, run.completed_at);
  considerBest(summary, run.score, run.wpm, run.acc, run.completed_at);
}

for (const room of h2hRooms) {
  const played =
    room.status === 'running' ||
    room.status === 'done' ||
    room.p1_submitted_at ||
    room.p2_submitted_at ||
    room.p1_score != null ||
    room.p2_score != null;
  if (!played) continue;
  addH2hOnlyRow(room, 'p1');
  addH2hOnlyRow(room, 'p2');
}

const rows = Array.from(summaries.values())
  .map((summary) => {
    const player = playersById.get(summary.player_id) || {};
    return {
      player_id: summary.player_id,
      name: player.name || '',
      title: player.title || '',
      company: player.company || '',
      phone: player.phone || '',
      player_event_day: player.event_day || '',
      player_created_at: player.created_at || '',
      played_days: Array.from(summary.played_days).filter(Boolean).sort().join('|'),
      first_played_at: summary.first_played_at || '',
      last_played_at: summary.last_played_at || '',
      race_runs: summary.race_runs,
      solo_runs: summary.solo_runs,
      event_runs: summary.event_runs,
      final_runs: summary.final_runs,
      total_played_records:
        summary.race_runs + summary.solo_runs + summary.final_runs,
      best_score: summary.best_score ?? '',
      best_wpm: summary.best_wpm ?? '',
      best_acc: summary.best_acc ?? '',
      best_at: summary.best_at || '',
    };
  })
  .sort((a, b) => {
    const byLastPlayed = compareDesc(a.last_played_at, b.last_played_at);
    if (byLastPlayed !== 0) return byLastPlayed;
    return a.name.localeCompare(b.name);
  });

const h2hRows = h2hOnlyRows.sort((a, b) => compareDesc(a.played_at, b.played_at));

await mkdir(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const suffix = dayFilter ? `-${dayFilter}` : '';
const usersCsv = path.join(OUT_DIR, `played-users${suffix}-${stamp}.csv`);
const usersJson = path.join(OUT_DIR, `played-users${suffix}-${stamp}.json`);
const h2hCsv = path.join(OUT_DIR, `h2h-players${suffix}-${stamp}.csv`);

await writeFile(usersCsv, toCsv(rows), 'utf8');
await writeFile(usersJson, JSON.stringify(rows, null, 2), 'utf8');
await writeFile(h2hCsv, toCsv(h2hRows), 'utf8');

console.log(`Exported ${rows.length} player records to ${usersCsv}`);
console.log(`Exported ${h2hRows.length} head-to-head name records to ${h2hCsv}`);
console.log(`JSON copy: ${usersJson}`);

function recordRaceLane(race, lane, playerId, played) {
  if (!playerId || !played) return;
  const score = race[`${lane}_score`];
  const wpm = race[`${lane}_wpm`];
  const acc = race[`${lane}_acc`];
  const submittedAt = race[`${lane}_submitted_at`];
  const summary = ensureSummary(playerId);
  summary.race_runs += 1;
  summary.played_days.add(race.event_day || '');
  touch(summary, race.created_at, race.ended_at || submittedAt || race.starts_at || race.created_at);
  considerBest(summary, score, wpm, acc, race.ended_at || submittedAt || race.created_at);
}

function addH2hOnlyRow(room, lane) {
  const name = room[`${lane}_name`];
  if (!name) return;
  const submittedAt = room[`${lane}_submitted_at`];
  h2hOnlyRows.push({
    room_id: room.id,
    lane,
    name,
    status: room.status || '',
    joined_at: room[`${lane}_joined_at`] || '',
    played_at: room.ended_at || submittedAt || room.created_at || '',
    score: room[`${lane}_score`] ?? '',
    wpm: room[`${lane}_wpm`] ?? '',
    acc: room[`${lane}_acc`] ?? '',
  });
}

function ensureSummary(playerId) {
  if (!summaries.has(playerId)) {
    summaries.set(playerId, {
      player_id: playerId,
      played_days: new Set(),
      first_played_at: '',
      last_played_at: '',
      race_runs: 0,
      solo_runs: 0,
      event_runs: 0,
      final_runs: 0,
      best_score: null,
      best_wpm: null,
      best_acc: null,
      best_at: '',
    });
  }
  return summaries.get(playerId);
}

function touch(summary, firstAt, lastAt) {
  if (firstAt && (!summary.first_played_at || firstAt < summary.first_played_at)) {
    summary.first_played_at = firstAt;
  }
  if (lastAt && (!summary.last_played_at || lastAt > summary.last_played_at)) {
    summary.last_played_at = lastAt;
  }
}

function considerBest(summary, score, wpm, acc, at) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return;
  const current = Number(summary.best_score);
  const isBetter =
    summary.best_score == null ||
    numericScore > current ||
    (numericScore === current && Number(acc || 0) > Number(summary.best_acc || 0)) ||
    (numericScore === current && Number(acc || 0) === Number(summary.best_acc || 0) && (at || '') < summary.best_at);
  if (!isBetter) return;
  summary.best_score = numericScore;
  summary.best_wpm = Number.isFinite(Number(wpm)) ? Number(wpm) : null;
  summary.best_acc = Number.isFinite(Number(acc)) ? Number(acc) : null;
  summary.best_at = at || '';
}

async function selectAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .range(from, to);
    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }
    out.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return out;
  }
}

async function loadEnv(filePath) {
  let body = '';
  try {
    body = await readFile(filePath, 'utf8');
  } catch {
    return;
  }
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] != null) continue;
    process.env[key] = unquote(raw.trim());
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function toCsv(rowsToWrite) {
  if (rowsToWrite.length === 0) return '';
  const headers = Object.keys(rowsToWrite[0]);
  const lines = [headers.join(',')];
  for (const row of rowsToWrite) {
    lines.push(headers.map((header) => csvCell(row[header])).join(','));
  }
  return lines.join('\n') + '\n';
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function compareDesc(left, right) {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left > right ? -1 : 1;
}
