# Technology Stack
_Last updated: 2026-04-25_

## Summary

Typing Race is a Next.js 14 (App Router) application written entirely in TypeScript. It uses React 18 on the frontend, Supabase as the sole backend service (PostgreSQL + Realtime), and deploys to Vercel. There are no testing frameworks, no linting config files (only `next lint` via the built-in Next.js ESLint integration), and no CSS pre-processors — styling is plain CSS in `app/globals.css`.

## Languages

**Primary:**
- TypeScript 5.9.3 (installed) / `^5.4.5` (declared) — all source files in `app/`, `components/`, `lib/`

**No JavaScript source files** — `allowJs: false` is set in `tsconfig.json`

## Runtime

**Environment:**
- Node.js v25.1.0 (host machine; no `.nvmrc` or `.node-version` pinning)
- Target: ES2022 (`tsconfig.json` `target`)

**Package Manager:**
- npm — `package-lock.json` present (lockfile version 3)

## Frameworks

**Core:**
- Next.js 14.2.35 (installed) / `^14.2.13` (declared) — App Router, React Server Components, API route handlers
- React 18.3.1 — client components (`'use client'` directive), hooks

**Build/Dev:**
- Next.js built-in webpack bundler — no custom webpack config
- `next dev -p 3000` / `next build` / `next start -p 3000` (see `package.json` scripts)
- `reactStrictMode: true` set in `next.config.mjs`

**No testing framework** — zero test files found, no jest/vitest/playwright config

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` 2.104.0 — database client + Realtime subscriptions. The only external service SDK in the project.
- `nanoid` 5.1.9 — generates short random IDs for players, races, rooms, runs

**Dev only (type definitions):**
- `@types/node` ^20.14.2
- `@types/react` ^18.3.3
- `@types/react-dom` ^18.3.0

## Configuration

**TypeScript (`tsconfig.json`):**
- `strict: false` — strict mode is explicitly disabled
- Path alias `@/*` maps to project root (e.g., `import { supabaseBrowser } from '@/lib/supabase'`)
- Module resolution: `bundler` (Next.js native)
- `isolatedModules: true`, `noEmit: true`

**Next.js (`next.config.mjs`):**
- Minimal config — only `reactStrictMode: true`, no custom headers, redirects, or image domains

**Linting:**
- Uses `next lint` (Next.js built-in ESLint). No `.eslintrc`, `.prettierrc`, or `biome.json` present.
- No formatting tool configured.

**Environment variables (see `.env.example`):**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (browser-safe)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (browser-safe, used for Realtime)
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (server-only, bypasses RLS)
- `ADMIN_TOKEN` — shared secret for admin endpoints; if unset, admin routes are open (dev mode)

## Platform Requirements

**Development:**
- Node.js (any recent version; host is v25.1.0)
- npm
- Supabase project with `supabase/schema.sql` applied (one-time SQL editor run)
- `.env.local` populated from `.env.example`

**Production:**
- Vercel (`.vercel/project.json` present: project `typing-competition`, org confirmed)
- Supabase hosted project
- Environment variables set in Vercel dashboard

## Open Questions

- No Node.js version is pinned (no `.nvmrc`, no `engines` field in `package.json`). Behavior on older Node versions is untested.
- `next lint` is configured but there's no CI to enforce it — unclear if it's run before deploy.
- `strict: false` in TypeScript means many type safety gaps exist silently.
