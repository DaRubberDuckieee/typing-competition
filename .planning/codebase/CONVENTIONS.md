# Conventions
_Last updated: 2026-04-25_

## Summary

The typing-race project is a Next.js 14 (App Router) + Supabase + React 18 typing competition application. It enforces TypeScript loosely (`strict: false`), uses server-side data aggregation with client-side Realtime subscriptions, and follows functional component patterns with React hooks exclusively. CSS is a mix of global stylesheets and inline `<style jsx>` blocks — no Tailwind or CSS modules. No ESLint/Prettier configuration is shipped.

## Naming Conventions

### Files
- **Page files**: Lowercase with hyphens (e.g., `play/page.tsx`, `lane/[id]/page.tsx`)
- **Component files**: PascalCase with `.tsx` extension (e.g., `TopBar.tsx`)
- **Utility/hook files**: camelCase with `.ts` extension (e.g., `useAppState.ts`, `api.ts`, `scoring.ts`, `state.ts`)
- **Type definition files**: `types.ts` (centralized type exports)

### Components & Functions
- **Page components**: Default exports, PascalCase (e.g., `export default function LanePage()`)
- **Internal component functions**: PascalCase, defined inline within pages (e.g., `Countdown`, `RunningLane`, `DoneLane`, `RenderedPassage`)
- **Custom hooks**: camelCase with `use` prefix (e.g., `useAppState`, `useRoom`)
- **API functions**: camelCase, grouped by domain in `lib/state.ts` (e.g., `startRace`, `submitTyped`, `finalizeRace`)
- **Utility functions**: camelCase (e.g., `computePhase`, `randomSpaceName`, `encodeSegments`)

### Variables
- **Constants**: UPPER_SNAKE_CASE (e.g., `COUNTDOWN_MS`, `SEG_PREFIX`, `SPACE_ADJ`, `SPACE_NOUN`)
- **State variables**: camelCase (e.g., `typed`, `phase`, `live`, `passages`)
- **Refs**: camelCase with `Ref` suffix (e.g., `submittedRef`, `keyRef`, `segStartRef`, `lastFetchRef`)

## TypeScript Usage Patterns

### Type Configuration
- **Strict mode**: `false` in `tsconfig.json` — allows implicit `any` and loose null checking
- **Target**: ES2022, module resolution: bundler (Next.js standard)
- **Path aliases**: `@/*` for absolute imports

### Type Definitions
- **Domain types**: Centralized in `lib/types.ts` (`Player`, `RaceRow`, `FinalRow`, `FinalRun`, `LBEntry`, `AppState`, `LiveView`)
- **Union types**: Used for state machines (e.g., `phase: 'idle' | 'countdown' | 'running' | 'done' | 'aborted'`)
- **Type inference**: Leveraged for `useState`/`useMemo` where types are obvious

### `any` Usage
- Used liberally: Supabase row data before casting (`live as any`), dynamic object patches (`const patch: any = {}`), CEO final typing (`(f as any).passage_id`)
- Pattern: cast to `any` when Supabase rows don't match expected shapes

## Component Patterns

### Server vs. Client Components
- **All user-facing pages**: `'use client'` (Next.js App Router)
- **No server-only rendering** for pages — all fetch state on mount client-side
- **API routes**: Server-side, use Supabase service role key for writes

### Hooks Usage
- Standard React hooks: `useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`
- Custom hooks: `useAppState()` (Realtime state), `useRoom()` (h2h room state)
- Cleanup: intervals and event listeners properly cleaned up in `useEffect` return
- Deps: manual `// eslint-disable-next-line react-hooks/exhaustive-deps` suppression where intentionally incomplete

### Functional Component Structure
- Root layout at `app/layout.tsx` wraps all pages with TopBar and CSS
- Pages are entry points; complex logic broken into named sub-functions inline (e.g., `Countdown`, `RunningLane`)
- No class components anywhere

## Import/Export Patterns

- **Default exports**: Page components
- **Named exports**: Utility functions, hooks, types
- **Absolute paths**: `@/` alias (e.g., `import { useAppState } from '@/components/useAppState'`)
- **Type imports**: Explicit `import type` for TypeScript-only imports
- **No barrel/index files**: Imports are direct from source files

## Styling Approach

- **Global stylesheet**: `app/globals.css` — base typography, colors, layout utilities
- **Inline `<style jsx>` blocks**: Component-scoped styling within pages
- **No Tailwind**, no CSS modules
- **CSS custom properties**: Used throughout for theming (`var(--p1)`, `var(--p2)`, `var(--err)`, `var(--amber)`, `var(--muted)`)
- **Layout utilities**: Flexbox/Grid via global CSS classes (`.row`, `.grid2`, `.card`, `.tile`, `.full-stage`, `.center`)
- **BEM-style naming**: Loose BEM in global CSS (e.g., `.hero__copy`, `.hero__panel`, `.lb-compact`)

## Error Handling Patterns

### Server-side (`lib/state.ts`)
- **Throw immediately**: DB operations throw on error (`if (error) throw error`)
- **Return error objects**: Idempotent operations return `{ ok: false, reason: 'error_code' }` for expected failures
- **Optimistic locking**: `.eq('status', current_status)` to prevent race conditions
- **Console.error**: Used for critical/unexpected failures

### Client-side
- **Try/catch**: Wrapped around `api()` calls; error message stored in state and displayed
- **Silent failures**: Some non-critical async operations use empty `catch {}` blocks
- **Fallback messages**: `e.message || 'could not start'` pattern

### API layer (`components/api.ts`)
- Non-200 responses throw: `if (!r.ok) throw new Error(json.error || r.statusText)`
- All requests include `cache: 'no-store'`

## Linting & Formatting Configuration

| Tool | Status |
|------|--------|
| ESLint | No config file; `next lint` script present but no custom rules |
| Prettier | Not configured |
| TypeScript strict | Disabled (`"strict": false`) |
| reactStrictMode | Enabled in `next.config.mjs` |

## Open Questions
- ESLint is in `package.json` scripts but not configured — intentional or oversight?
- `strict: false` allows silent bugs from null/undefined — intentional for rapid development?
