# Testing
_Last updated: 2026-04-25_

## Summary

**No tests exist in this codebase.** The project has no Jest, Vitest, Playwright, or any other test framework configured. The `package.json` lists no test dependencies and no test scripts. This is a significant gap, as the application handles real-time multiplayer scoring, state synchronization, and database operations that all benefit from automated coverage.

## Test Frameworks Present

**None.** `devDependencies` in `package.json` only includes:
- `@types/node`, `@types/react`, `@types/react-dom` (type definitions)
- `typescript` (compiler)

### npm Scripts
```json
"scripts": {
  "dev": "next dev -p 3000",
  "build": "next build",
  "start": "next start -p 3000",
  "lint": "next lint"
}
```
No test command. `npm test` would fail.

## Test File Locations

No test files found anywhere:
- No `__tests__` directories
- No `.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx` files
- No `e2e/`, `integration/`, or `unit/` directories
- No test setup files (jest.config.js, vitest.config.ts, etc.)

## What IS Tested vs. What ISN'T

**Currently tested: Nothing.**

## Critical Areas That Need Tests (Priority Order)

### 1. Scoring Algorithm (`lib/scoring.ts`) — HIGHEST PRIORITY
`classifyAndScore()` is the core algorithm; deterministic and pure, easy to unit test.
- Perfect typing (100% accuracy, expected WPM)
- Case mismatches (`case_mismatch` counter increments)
- Transpositions (e.g., "huose" → "house")
- Duplicates (e.g., "homee" → "home")
- Partial passages (short time runs — untyped tail not counted as error)
- Empty input, zero elapsed time edge cases

### 2. Winner Determination (`lib/scoring.ts`)
`determineWinner()` tiebreaker logic: score → accuracy → correct_chars → finish time.
- A higher score → A wins
- Tied score, A higher accuracy → A wins
- All tied → 'tie' result

### 3. State Aggregation (`lib/state.ts`)
`leaderboard()` merges race + solo run scores, picks best per player, sorts.
- Multiple players with different best scores
- Player with both race and solo run scores (picks best)
- Leaderboard limit (top 20)
- Empty leaderboard

### 4. Race/Run Lifecycle (`lib/state.ts`)
`finalizeRace()`, `finalizeSoloRun()`, `finalizeRoom()` — idempotent operations.
- Cannot start race if one is pending/running
- Finalize is idempotent (safe to call twice, same result)
- Both players must submit before finalize scores
- Segment encoding/decoding (`encodeSegments`/`decodeSegments` with `__SEG__` prefix)

### 5. Client State Synchronization (`components/useAppState.ts`)
- Initial fetch succeeds on mount
- Debounced refetch on Realtime change (120ms delay)
- Polling triggers every 10s as fallback
- Multiple rapid updates debounce correctly

### 6. Player Naming & Uniqueness (`lib/state.ts`)
`createAnonymousPlayer()`, `renamePlayer()`, `upsertPlayer()`.
- Anonymous player generates unique space-themed name
- Retry on collision (append " #2", " #3")
- Name trimming and max length

## Recommended Test Setup

### Framework: Vitest + React Testing Library
```bash
npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/user-event jsdom
```

### Suggested `package.json` scripts (once added):
```json
"test": "vitest run",
"test:watch": "vitest",
"coverage": "vitest run --coverage"
```

### Suggested structure:
```
lib/__tests__/scoring.test.ts     # 50+ cases — deterministic, no mocks needed
lib/__tests__/state.test.ts       # 100+ cases — mock Supabase client
lib/__tests__/passages.test.ts    # 10+ cases
components/__tests__/useAppState.test.ts  # 20+ cases — mock fetch + Supabase
```

## Open Questions
- Is the absence of tests intentional for a one-day event tool, or is coverage wanted before reuse?
- Are there plans to use this codebase for future events? If so, scoring unit tests should be added immediately.
