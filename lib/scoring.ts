// Deterministic scorer. Same algorithm as before; now in TS.
// Given canonical passage `target`, typed string `typed`, elapsed ms, and
// duration (seconds), produces correctChars / WPM / accuracy / score +
// per-category error counts.
//
// Classification (per non-correct typed position):
//   - case_mismatch: same letter, different case
//   - duplicate:     same as previous typed char (stutter like "homee")
//   - transposition: adjacent swap ("huose" vs "house")
//   - other:         everything else
//
// Untyped tail is NOT counted as error; it just lowers WPM.

export type ScoreResult = {
  correctChars: number;
  typedLen: number;
  targetLen: number;
  errors: { case_mismatch: number; transposition: number; duplicate: number; other: number };
  wpm: number;
  acc: number;
  score: number;
  elapsedMs: number;
};

export function classifyAndScore(args: {
  target: string;
  typed: string;
  elapsedMs: number;
  durationS: number;
}): ScoreResult {
  const { target, typed, durationS } = args;
  const effectiveMs = Math.max(1, Math.min(args.elapsedMs, durationS * 1000));
  const errors = { case_mismatch: 0, transposition: 0, duplicate: 0, other: 0 };
  let correct = 0;
  let i = 0;
  let j = 0;

  while (i < typed.length && j < target.length) {
    const t = typed[i];
    const g = target[j];
    if (t === g) {
      correct++;
      i++;
      j++;
      continue;
    }
    if (t.toLowerCase() === g.toLowerCase()) {
      errors.case_mismatch++;
      i++;
      j++;
      continue;
    }
    if (i > 0 && t === typed[i - 1]) {
      errors.duplicate++;
      i++;
      continue;
    }
    if (
      i + 1 < typed.length &&
      j + 1 < target.length &&
      typed[i] === target[j + 1] &&
      typed[i + 1] === target[j]
    ) {
      errors.transposition += 2;
      i += 2;
      j += 2;
      continue;
    }
    errors.other++;
    i++;
    j++;
  }

  const typedLen = typed.length;
  const wpm = correct / 5 / (effectiveMs / 60000);
  const acc = (correct / Math.max(1, typedLen)) * 100;
  const score = wpm * Math.pow(acc / 100, 2) * 10;

  return {
    correctChars: correct,
    typedLen,
    targetLen: target.length,
    errors,
    wpm: round1(wpm),
    acc: round1(acc),
    score: round1(score),
    elapsedMs: effectiveMs,
  };
}

export function determineWinner(
  a: { score: number; acc: number; correctChars: number; endedAt: number },
  b: { score: number; acc: number; correctChars: number; endedAt: number }
): 'a' | 'b' | 'tie' {
  if (a.score !== b.score) return a.score > b.score ? 'a' : 'b';
  if (a.acc !== b.acc) return a.acc > b.acc ? 'a' : 'b';
  if (a.correctChars !== b.correctChars) return a.correctChars > b.correctChars ? 'a' : 'b';
  if (a.endedAt !== b.endedAt) return a.endedAt < b.endedAt ? 'a' : 'b';
  return 'tie';
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}
