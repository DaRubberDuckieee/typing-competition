# mngr Learnings — typing-race

Running journal of learnings, gotchas, and "huh, that's interesting" moments while using [mngr](https://github.com/imbue-ai/mngr) (imbue's CLI for managing coding agents) to develop the Braintrust typing-race app.

**Why this doc exists:** Jess is a DevRel consultant for imbue and is using a real project (this one) to learn mngr deeply, with the goal of generating multiple blog posts and content pieces from the experience. This is the raw notes file; blog drafts spawn from here.

---

## Setup

**Installed:** 2026-04-26
**Version:** mngr 0.2.5
**Method:** `uv tool install imbue-mngr`
**System deps already present:** uv, claude (Claude Code 2.1.119), tmux, jq, rsync, git, ssh
**System deps installed alongside:** unison (via brew, optional — used by `mngr pair`)
**Modal account:** not yet — running local-only until we hit a real reason to scale out

---

## Mental model

mngr is "git for agents":
- `create` = `git clone` (spin up a new agent)
- `list` = `git status` (what's running)
- `message` = send a prompt without attaching
- `connect` = drop into the agent's tmux session
- `snapshot` / `clone` = fork agent state
- `destroy` = clean up

Each agent is a tmux session on some host (local or remote SSH-accessible). Agents auto-shutdown when idle (saves money on Modal; doesn't matter locally).

---

## Workflow ideas to try

- [ ] One agent per feature (parallel work, no merge conflicts in-flight)
- [ ] Snapshot before risky refactors so we can fork-and-revert
- [ ] `mngr pair` (continuous sync) for live-coding feel
- [ ] Spawn 3 agents trying different approaches to the same problem, pick the best
- [ ] Use `mngr ask` instead of googling mngr docs

---

## Learnings (chronological)

### 2026-04-26 — Install & first impressions

- Install was clean: `uv tool install imbue-mngr` after the homebrew prereqs. Total time: ~30 seconds.
- `mngr --help` shows ~25 subcommands. Several are marked `[experimental]` — flag for the blog: which ones bite us?
- No config file required to start — just `mngr create` from inside a project dir and it figures it out.

### 2026-04-26 — First real workflow: A/B parallel agents on h2h room codes

**Setup:** asked Dumbass to refactor the head-to-head flow from "share 3 URLs" to "create-or-join-by-code." Instead of running one Claude Code session, spawned two mngr agents with deliberately different prompts:

- `h2h-codes-minimal` — minimal change: add a `code` column to the existing `h2h_rooms` table, retrofit the UI.
- `h2h-lobby-redesign` — bigger swing: design a proper lobby model with name + code entry, real-time slot updates, gated start.

**The killer feature I learned today:** `mngr create` for local agents automatically creates a **git worktree** that shares objects with the main repo. So both agents work on the same codebase in isolated branches without conflicts. This is the difference between mngr and "just run two terminals" — you'd otherwise have to set up worktrees manually.

**Commands used:**
```bash
cd typing-race
mngr create h2h-codes-minimal --no-connect --message "$(cat prompt-a.txt)"
mngr create h2h-lobby-redesign --no-connect --message "$(cat prompt-b.txt)"
mngr list   # see both running
```

**Both spun up in <2s each** as advertised. They show STATE=WAITING while processing the initial message. Docker provider warning is harmless when Docker isn't running locally.

**Open question:** how do I diff their results? Each is in a separate worktree. Likely: `mngr exec <name> "git diff main"` or `mngr pull <name>` to bring changes back. Will figure out when they finish.

**Blog angle worth keeping:** this workflow (one prompt, two implementations, pick the better one) is genuinely something Claude-Code-alone can't do without painful manual setup. Distinct mngr selling point.

### 2026-04-26 evening — The three-gotcha gauntlet

The first agent run sat unread for 7 hours. Investigating revealed a stack of issues that any new mngr user is going to hit. Worth documenting in detail.

**Gotcha 1: `mngr create --message` with the default `claude` agent type pastes-but-doesn't-submit.**

The default `claude` agent type runs Claude Code in TUI mode inside a tmux session. `mngr create --message "..."` pastes the prompt into the input box, but the TUI doesn't receive an Enter keystroke. The prompt sits there as a paste buffer and the agent does nothing. `mngr message` after the fact has the same problem.

**Diagnosis:** `mngr capture <agent>` shows the literal input box with `[Pasted text #1 +13 lines]` and no submission. State stays at WAITING.

**Fix:** Use the `headless_claude` agent type from the `imbue-mngr-claude` plugin. Install with `mngr plugin add imbue-mngr-claude`, then `mngr create --type headless_claude`. This runs `claude --print` non-interactively in the background — no TUI, no submission problem.

**Gotcha 2: `headless_claude` doesn't quote prompts when building the shell command.**

Looking at `data.json` for a headless agent reveals the actual command: `claude --print Read the file .planning/foo.md... > stdout 2> stderr`. The prompt is unquoted. So when the shell parses it, only the first word (`Read`) becomes the prompt argument; everything else is dropped or treated as separate args.

**Diagnosis:** check `cat ~/.mngr/agents/<id>/data.json | jq '.command'`. If your prompt isn't in `"..."`, it's getting tokenized.

**Fix:** Wrap the prompt in literal double quotes when passing to `mngr create -- ...`:

```bash
mngr create my-agent --type headless_claude --no-connect -- '"Your full prompt with spaces here."'
```

The outer single quotes preserve the inner double quotes through mngr's argv handling so they reach the shell intact.

**Gotcha 3: `claude --print` blocks on file/edit permissions by default.**

Even with the prompt finally landing correctly, the agent can hang or refuse to proceed when it tries to write files because Claude Code is asking for permission on each tool call — and there's no human at the TUI to say yes.

**Fix:** Pass `--permission-mode bypassPermissions` after the prompt:

```bash
mngr create my-agent --type headless_claude --no-connect -- '"My prompt."' --permission-mode bypassPermissions
```

Safe-ish here because each agent runs in its own isolated git worktree under `~/.mngr/worktrees/`. Worst case you `mngr destroy <name> -b` and start over. Real concern would be on a remote/Modal host with secrets in the env; for local Next.js dev this is fine.

**Bonus: worktrees branch from `HEAD`, not your working tree.**

Uncommitted files don't follow the agent into its worktree. Either commit the files first (e.g., the prompt markdown files in `.planning/mngr-prompts/`) or copy them into the worktree path after creation.

**The combined working invocation:**

```bash
cd typing-race
git add .planning/mngr-prompts/ && git commit -m "add mngr prompts"
mngr create h2h-codes-minimal --type headless_claude --no-connect -- \
  '"Read .planning/mngr-prompts/h2h-codes-minimal.md and execute every instruction. Do not stop until done."' \
  --permission-mode bypassPermissions
```

**Blog angle:** the entire "three gotchas in one afternoon" sequence — paste-no-submit → unquoted prompt → permission blocking — is genuinely the kind of thing a developer hits in their first hour with mngr. Documenting the diagnostic process (read `data.json`, check `mngr capture`, look at stdout.jsonl) is content gold for a real-world post.

(Add new entries below as we use it.)

---

## Open questions for the blog(s)

- How does mngr handle Next.js dev servers? Does the agent run `npm run dev` inside the tmux session, or do we keep that separate?
- What does `mngr push` / `mngr pull` look like in practice on a Vercel-deployed project?
- Snapshot story for stateful projects (Supabase migrations, etc.)
- Comparison with: just running Claude Code directly, GSD workflows, git worktrees
- Cost story (when does Modal beat local?)
- Multi-agent coordination — does it deadlock, conflict, or play nicely?

---

## Blog post candidates (parking lot)

1. "Building a real app with mngr: my first week"
2. "git for agents: the mental model that finally clicked"
3. "Multi-agent workflows in practice (typing-race case study)"
4. "When to reach for Modal: scaling agents from local to remote"
5. "mngr vs Claude Code direct: same thing, different shape?"
6. "The snapshot/fork workflow for risky refactors"
