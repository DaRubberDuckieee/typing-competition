# GSD setup for `typing-race`

This is a brownfield project (has existing code, no `.planning/` yet). Below is the exact run order.

---

## One-time: open Claude Code in the project

```bash
cd "/Users/jess/Documents/🌈 Coding Projects/Work (Braintrust)/typing-race"
claude
```

Claude Code launches as a TUI in your terminal. All `/gsd-*` commands below run inside that TUI by typing them at the prompt.

---

## Step 1 — Map the existing codebase

```
/gsd-map-codebase
```

**What it does:** spawns 4 parallel agents that read your code and write 7 docs to `.planning/codebase/`:
- `STACK.md`, `INTEGRATIONS.md` — tech + 3rd-party services
- `ARCHITECTURE.md`, `STRUCTURE.md` — how the app is organized
- `CONVENTIONS.md`, `TESTING.md` — patterns + test setup
- `CONCERNS.md` — risks/debt the agents noticed

**Why first:** brownfield projects need this baseline. Skip it for greenfield (your case is brownfield: Next.js + Supabase, README, app/, components/, lib/).

**Time:** 2–5 min. Mostly hands-off, just watch.

---

## Step 2 — Initialize the project plan

```
/gsd-new-project
```

**What it does:** asks you a series of questions about the project (goals, scope, constraints, target users), then writes:
- `.planning/PROJECT.md` — the brief
- `.planning/config.json` — workflow prefs
- `.planning/REQUIREMENTS.md` — scoped requirements
- `.planning/ROADMAP.md` — phased plan
- `.planning/STATE.md` — durable memory

**Heads up:** this is interactive. Answer each question concisely. If you have an existing idea doc, reference it with `@path/to/doc.md` in your first answer.

**Time:** 10–20 min depending on how thorough you go.

---

## Step 3 — Start the first phase

```
/gsd-plan-phase 1
```

This drafts phase 1 in detail (tasks, files to touch, acceptance criteria). Then:

```
/gsd-execute-phase 1
```

Drives the actual work — Claude Code will edit files, run commands, check off todos.

---

## Day-to-day commands you'll actually use

| Command | When |
|---|---|
| `/gsd-status` | "Where am I?" — shows current phase, todos, blockers |
| `/gsd-add-todo <text>` | Drop a task into the backlog |
| `/gsd-next` | Pick the next thing to work on |
| `/gsd-plan-phase N` | Plan the next phase |
| `/gsd-execute-phase N` | Run the phase |
| `/gsd-summary` | Generate `SUMMARY.md` (good for weekly recaps) |
| `/gsd-map-codebase` | Re-run after big changes |

Full list: type `/` in Claude Code → autocomplete shows all 80+ `gsd-*` commands.

---

## Where the durable artifacts live

```
typing-race/.planning/
├── PROJECT.md         ← the brief
├── REQUIREMENTS.md    ← what we're building
├── ROADMAP.md         ← phase structure
├── STATE.md           ← memory (always re-read)
├── SUMMARY.md         ← human-readable digest (when you ask)
├── config.json
├── codebase/          ← from /gsd-map-codebase
│   ├── STACK.md
│   ├── ARCHITECTURE.md
│   ├── STRUCTURE.md
│   ├── CONVENTIONS.md
│   ├── TESTING.md
│   ├── INTEGRATIONS.md
│   └── CONCERNS.md
└── phases/
    ├── phase-1.md
    ├── phase-2.md
    └── ...
```

These commit to git with the rest of your code. That's the point — your build history is queryable.

---

## Tips

- **Commit `.planning/` to git.** It's the source of truth for "what did I build this week" — Dumbass will eventually mine these for TikTok content ideas.
- **Don't edit `.planning/` files by hand mid-phase** unless you really mean to. The agent re-reads them constantly.
- **If you get lost:** run `/gsd-status`. Always works.
- **To exit Claude Code:** Ctrl+C twice, or type `/exit`.
- **Update GSD itself:** `npx get-shit-done-cc@latest` (occasional, outside Claude Code).

---

## Quick-reference: today's setup sequence

```bash
cd "/Users/jess/Documents/🌈 Coding Projects/Work (Braintrust)/typing-race"
claude
```

Then in the TUI, in order:
1. `/gsd-map-codebase` — wait for it to finish
2. `/gsd-new-project` — answer the questions
3. `/gsd-plan-phase 1` — draft phase 1
4. `/gsd-execute-phase 1` — start working

That's it. `.planning/` will exist by the end of step 2.
