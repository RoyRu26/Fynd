---
name: autopilot
description: Autonomously build Fynd by working through ROADMAP.md item by item (plan, build, verify, review, commit), stopping at checkpoints and decisions. Use when Roy says "autopilot", "continue the roadmap", or "build the next milestone".
---

# Autopilot

You are the orchestrator. Keep your own context small: delegate each item's heavy work to subagents and only keep their summaries.

## Before starting

1. Read `ROADMAP.md`, `CLAUDE.md`, and skim `DESIGN.md` §1, §13–§15.
2. `git status` must be clean. If not, stop and tell Roy what is uncommitted.
3. Work on a branch: `git checkout -b autopilot/m<milestone>` (or continue it if it exists). Never push, never touch the remote Supabase project.
4. Check the local Supabase stack is up (`pnpm exec supabase status` from repo root). If not, try `pnpm exec supabase start`; if that fails (e.g. Docker not running), stop and tell Roy.

## Loop — for the first unchecked item in the current milestone

1. **Gate.** If the item is tagged [DECISION] with no recorded answer, or would require resolving a DESIGN.md [OPEN] item, or needs a secret/account Roy hasn't provided: stop and ask Roy one clear question with options. Do not guess.
2. **Plan.** Spawn a `Plan` subagent: give it the item text and ask for a concrete plan (DB changes, files to create/change following `new-feature` / `new-migration` skills, tests, risks). Review the plan yourself against CLAUDE.md rules. If the item is too big, split it into sub-steps and do them in order.
3. **Build.** Spawn a `general-purpose` subagent with the approved plan. Instruct it to: follow the `new-migration` and/or `new-feature` skills, follow CLAUDE.md and DESIGN.md exactly, then run the `verify` skill and fix every failure before returning. It must return: files changed, checks run with results, and anything it couldn't do.
4. **Review.** Spawn the `code-reviewer` agent. If any SQL changed, also spawn `supabase-security-reviewer` (in parallel).
5. **Fix.** If there are Must fix / Critical / High findings, spawn a `general-purpose` subagent to fix them and re-run `verify`. Re-review once. If the same problem survives two fix rounds, stop and tell Roy.
6. **Commit.** `git add` only the files for this item, commit as `feat(<area>): <item number> <short description>`.
7. **Record.** Tick the item in `ROADMAP.md`, append a line to the Progress log (date, item, short hash, notes/follow-ups), commit that too.
8. Continue to the next item.

## At a Checkpoint

Stop. Give Roy:
- What was built (one line per item) and any follow-ups or compromises.
- A **phone test script**: numbered steps to try, including at least one with two accounts where relevant (chat, follows, blocks).
- Anything he needs to do (e.g. secrets, accounts).
Then wait. Resume only when Roy says to continue; fix anything he reports first.

## Never

- Never skip `verify` or commit with failing checks.
- Never edit applied migrations, `src/types/database.ts` by hand, or `.env` files.
- Never add dependencies without saying why in the commit message; prefer what's already installed.
- Never weaken RLS, grants or tests to make something pass.
- Never start items outside the current milestone.
