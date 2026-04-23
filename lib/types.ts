export type Player = {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  event_day: string;
};

export type RaceRow = {
  id: string;
  event_day: string;
  p1_id: string;
  p2_id: string;
  passage_id: string;
  duration_s: number;
  countdown_started_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
  status: 'pending' | 'running' | 'done' | 'aborted';
  p1_text: string | null;
  p2_text: string | null;
  p1_submitted_at: string | null;
  p2_submitted_at: string | null;
  p1_score: number | null;
  p2_score: number | null;
  p1_wpm: number | null;
  p2_wpm: number | null;
  p1_acc: number | null;
  p2_acc: number | null;
  p1_errors: any;
  p2_errors: any;
  winner_id: string | null;
};

export type QueueRow = {
  id: string;
  event_day: string;
  player_id: string;
  position: number;
  status: 'waiting' | 'racing' | 'done' | 'noshow';
};

export type FinalRow = {
  id: number;
  event_day: string;
  state: 'locked' | 'running' | 'done';
  passage_id: string;
  duration_s: number;
  order_json: string[];
  current_index: number;
  started_at: string | null;
  ended_at: string | null;
  is_ceo: boolean;
  current_player_id: string | null;
  current_countdown_started_at: string | null;
  current_starts_at: string | null;
  current_ends_at: string | null;
  current_text: string | null;
  current_submitted_at: string | null;
  current_status: 'pending' | 'done' | null;
};

export type FinalRun = {
  id: string;
  final_id: number;
  player_id: string;
  score: number;
  wpm: number;
  acc: number;
  text: string | null;
  errors: any;
  completed_at: string;
};

export type LBEntry = {
  player_id: string;
  name: string;
  title: string | null;
  company: string | null;
  best_score: number;
  best_acc: number;
  best_at: string;
};

export type AppState = {
  event: { event_day: string; status: string };
  live: LiveView | null;
  leaderboard: LBEntry[];
  top5: LBEntry[];
  queue: (QueueRow & { name: string; title: string | null; company: string | null })[];
  final: (FinalRow & {
    players: { id: string; name: string; company: string | null; run: FinalRun | null }[];
  }) | null;
  ceoFinal: any | null;
  passages: { id: string; kind: string; length: number }[];
  serverTime: number;
};

// Unified "what is happening now" view.
export type LiveView =
  | ({ kind: 'race'; passageText: string; p1Name: string; p2Name: string } & RaceRow)
  | ({ kind: 'final'; passageText: string; playerName: string } & FinalRow);
