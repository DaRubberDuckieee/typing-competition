// Fixed library of passages. Two prompts, consistent difficulty.
// p1 is a code snippet; p2 is a parody of a bad system prompt.
export type Passage = { id: string; kind: 'prose' | 'code'; text: string };

export const PASSAGES: Passage[] = [
  {
    id: 'p1',
    kind: 'code',
    text:
      'async function retryWorkflow(ctx, attempt = 0) {\n  // TODO: figure out what maxRetries actually should be\n  const maxRetries = ctx.options?.maxRetries ?? 3; // probably fine\n  if (attempt >= maxRetries) throw new Error("giving up (sorry)");\n  await sleep(attempt * 1000); // exponential backoff (trust me)\n  return ctx.run("step", async () => doTheThing(ctx, attempt));\n}',
  },
  {
    id: 'p2',
    kind: 'prose',
    text:
      "You are a senior principal staff distinguished AI assistant with 20+ years of experience in the field of software engineering, productivity, and things in general. Please respond in the style of a helpful but concise expert, while also being thorough. Do not be too short. Do not be too long. Use bullet points unless prose is more appropriate, which it usually is. Begin your response with a brief summary, then expand on it in detail, then summarize again. Never say 'certainly' or 'of course.' Output only JSON. (Do not output JSON.)",
  },
];

export function getPassage(id: string): Passage {
  return PASSAGES.find((p) => p.id === id) || PASSAGES[0];
}

export function randomQualifyingPassage(): Passage {
  return PASSAGES[Math.floor(Math.random() * PASSAGES.length)];
}
