// Library of Braintrust-themed passages for the booth typing competition.
// Each one is short (~60-110 chars) so an average typist (~40 wpm) finishes
// 1-2 in 60s and a fast typist gets through 3+. Mix of prose (BT pitch
// lines) and code (canonical SDK shapes) so the typing feel varies.
export type Passage = { id: string; kind: 'prose' | 'code'; text: string };

export const PASSAGES: Passage[] = [
  // -------- Prose: Braintrust pitch lines --------
  {
    id: 'bt-prose-1',
    kind: 'prose',
    text: 'Braintrust is the all-in-one platform for evaluating, debugging, and shipping AI products.',
  },
  {
    id: 'bt-prose-2',
    kind: 'prose',
    text: 'Stop debugging by guessing. Braintrust traces every prompt, response, and score for your AI app.',
  },
  {
    id: 'bt-prose-3',
    kind: 'prose',
    text: 'Run evals over thousands of cases and catch regressions before users ever see them.',
  },
  {
    id: 'bt-prose-4',
    kind: 'prose',
    text: 'Compare prompts side by side in the playground, pick the winner, and iterate fast.',
  },
  {
    id: 'bt-prose-5',
    kind: 'prose',
    text: 'Ship LLM features with confidence. Braintrust handles your evaluations end to end.',
  },
  {
    id: 'bt-prose-6',
    kind: 'prose',
    text: 'Observability and offline evals in one workspace. Built for teams shipping real AI.',
  },
  {
    id: 'bt-prose-7',
    kind: 'prose',
    text: 'Wire up scorers, log spans, and watch your model improve over time. That is Braintrust.',
  },
  // -------- Code: canonical SDK shapes --------
  {
    id: 'bt-code-eval',
    kind: 'code',
    text: "Eval('my-task', { data, task, scores: [Factuality] });",
  },
  {
    id: 'bt-code-traced',
    kind: 'code',
    text: 'await traced(async (span) => span.log({ input, output }));',
  },
  {
    id: 'bt-code-wrap',
    kind: 'code',
    text: "const client = wrapOpenAI(new OpenAI({ apiKey }));",
  },
  {
    id: 'bt-code-init',
    kind: 'code',
    text: "initLogger({ projectName: 'my-app' });",
  },
  {
    id: 'bt-code-import',
    kind: 'code',
    text: "import { Eval, Factuality } from 'autoevals';",
  },
  {
    id: 'bt-code-score',
    kind: 'code',
    text: 'const score = await Factuality({ input, output, expected });',
  },
];

// Resolves any passage id from BOTH the booth set and the finals set. The
// scoring layer (lib/state.ts) calls this without knowing which mode the
// run came from, so we want a single lookup that works for either.
export function getPassage(id: string): Passage {
  return (
    PASSAGES.find((p) => p.id === id) ||
    FINALS_PASSAGES.find((p) => p.id === id) ||
    PASSAGES[0]
  );
}

export function randomQualifyingPassage(): Passage {
  return PASSAGES[Math.floor(Math.random() * PASSAGES.length)];
}

// ----- Day-end final event passages -----
// Separate, longer, slightly harder passages used only for the per-day final
// event. Kept distinct from booth `PASSAGES` so booth players who've been
// memorizing prompts all day can't game the final. Same structure (prose +
// code) but the prose lines are deeper Braintrust pitches and the code
// snippets exercise more punctuation / shifted characters.
export const FINALS_PASSAGES: Passage[] = [
  {
    id: 'fin-prose-1',
    kind: 'prose',
    text: 'Braintrust gives engineering teams a single workspace to evaluate, debug, and observe their AI systems before users notice anything has slipped.',
  },
  {
    id: 'fin-prose-2',
    kind: 'prose',
    text: "You can't ship LLM features the way you ship deterministic code. Braintrust treats prompts as artifacts, scores them at scale, and tracks how they evolve.",
  },
  {
    id: 'fin-prose-3',
    kind: 'prose',
    text: 'Run your evals against thousands of cases. Compare prompts side by side. See where each version regresses. Ship the winner.',
  },
  {
    id: 'fin-prose-4',
    kind: 'prose',
    text: 'Every prompt, every response, every score — all logged and queryable. Your AI app stops being a black box.',
  },
  {
    id: 'fin-prose-5',
    kind: 'prose',
    text: 'From a one-off prompt experiment to a production AI feature with thousands of evals per day, Braintrust grows with the team that ships it.',
  },
  {
    id: 'fin-code-1',
    kind: 'code',
    text: "Eval('summarize-tickets', { data: tickets, task: summarize, scores: [Factuality, Helpfulness] });",
  },
  {
    id: 'fin-code-2',
    kind: 'code',
    text: "const client = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));",
  },
  {
    id: 'fin-code-3',
    kind: 'code',
    text: 'await traced(async (span) => {\n  span.log({ input, output, expected, scores: { factuality } });\n});',
  },
  {
    id: 'fin-code-4',
    kind: 'code',
    text: "initLogger({ projectName: 'shipping-agent', apiKey: process.env.BRAINTRUST_API_KEY });",
  },
  {
    id: 'fin-code-5',
    kind: 'code',
    text: "const { score, metadata } = await Factuality({ input, output, expected: 'the user wants a refund' });",
  },
];

// Stable hash of an arbitrary string. Used so all finalists on the same day
// get the same passage sequence (deterministic by today's UTC date string)
// without storing the chosen sequence in the database.
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

// Pick the day's 8-passage sequence for the final event. Same input string
// (typically `todayString()` from lib/state.ts) always returns the same
// sequence in the same order — so all 10 finalists on a given day type the
// exact same thing. Different days produce different sequences (best-effort
// via the hash; not cryptographically random, but visually distinct).
export function pickFinalsPassageIds(seed: string): string[] {
  const ids = FINALS_PASSAGES.map((p) => p.id);
  if (ids.length <= 1) return ids;
  // Seeded Fisher–Yates: each swap index is derived from the running hash so
  // the same seed produces the same shuffle.
  let h = hashStr(seed) || 1;
  for (let i = ids.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0; // LCG advance
    const j = h % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.min(8, ids.length));
}

// Look up a finals passage by id; falls back to booth passages if the id
// happens to point there (defensive against future renames).
export function getFinalsPassage(id: string): Passage {
  return (
    FINALS_PASSAGES.find((p) => p.id === id) ||
    PASSAGES.find((p) => p.id === id) ||
    FINALS_PASSAGES[0]
  );
}
