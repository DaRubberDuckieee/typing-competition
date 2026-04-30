// Turns raw error messages from anywhere in the stack — Postgres / PostgREST
// schema-cache errors, Supabase client errors, our own thrown error codes,
// network failures — into messages that are OK to show a player at the
// conference booth. Pure function, safe to import from both server and
// client code (no env vars or `supabase` imports here).
export function friendlyError(raw: unknown): string {
  const msg = String((raw as any)?.message || raw || '').trim();
  const lower = msg.toLowerCase();

  // 1. Our own app-defined error codes (matched verbatim).
  switch (msg) {
    case 'phone_invalid':
      return 'Please enter a valid phone number (10+ digits).';
    case 'name_required':
      return 'Please enter your name.';
    case 'event_not_running':
      return "The booth isn't open right now. Please find a staff member.";
    case 'lane_invalid':
      return 'Something went wrong with the lane. Refresh the page and try again.';
    case 'room_not_found':
    case 'race_not_found':
      return "Couldn't find that race. Head back to the leaderboard and try again.";
    case 'race_in_progress':
      return 'Another race is already in progress. Please wait a moment.';
    case 'duplicate_player':
      return "Both lanes can't be the same person — please use a different phone number.";
    case 'need_two_players':
      return 'Both lanes need a player before the race can start.';
    case 'player_not_found':
      return "We couldn't find a player with that phone. Race at the booth first — your phone is your ticket.";
    case 'not_eligible':
      return "You're not in today's top 20 yet. Keep racing at the booth and check back!";
    case 'event_not_open':
      return 'The Final Event opens at 5pm Pacific. Keep racing at the booth to make today\u2019s top 20!';
    case 'lane_already_taken':
      return 'Someone just stepped up to that lane — try again in a second.';
    case 'name_collision_limit':
      return "That name's been taken too many times today. Try a slight variation.";
  }

  // 2. PostgREST stale schema cache (the column-of-table-not-in-cache flavor).
  if (lower.includes('schema cache') && (lower.includes('column') || lower.includes('relation'))) {
    return "The booth's database is missing a recent update. Please ask a staff member to refresh the schema, or try again in a few seconds.";
  }

  // 3. Postgres constraint flavors. These are usually data-integrity surprises
  // we'd rather not expose verbatim.
  if (lower.includes('duplicate key') || lower.includes('unique constraint')) {
    return 'That value is already taken — please try a different one.';
  }
  if (lower.includes('foreign key') || lower.includes('violates not-null') || lower.includes('not-null constraint')) {
    return 'Database problem — please ask a staff member.';
  }
  if (lower.includes('permission denied') || lower.includes('row-level security')) {
    return "We can't write to the database right now. Please ask a staff member.";
  }

  // 4. Network / timing.
  if (lower.includes('aborted') || lower.includes('timeout') || lower.includes('failed to fetch') || lower.includes('network')) {
    return "The server isn't responding. Please try again in a moment.";
  }

  // 5. Catch-all heuristics. snake_case-only strings look like internal codes
  // and shouldn't be shown raw; we'd rather show a generic line.
  if (msg.length === 0) return 'Something went wrong. Please try again.';
  if (/^[a-z][a-z0-9_]*$/.test(msg)) return 'Something went wrong. Please try again.';
  // Otherwise the message is probably already a sentence intended for users.
  return msg;
}
