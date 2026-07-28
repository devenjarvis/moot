---
name: ship-it
description: >
  Quality gate and PR pipeline in one. Reviews the code, verifies acceptance
  criteria against the plan, fixes what it finds, then commits, opens a draft PR,
  drives CI green, and marks it ready. Use when implementation is complete.
  Triggered by "validate it", "validate this", "run validation", "ship it",
  "open a PR", or /ship-it.
---

# Ship It

Validate the work, fix what's broken, get the user's go-ahead, then ship it through CI.

**Announce at start:** "Using ship-it to validate the implementation and open a PR."

## 1. Load Context

Read the plan from `{worktree-root}/.claude/plan.md`, falling back to the in-session plan context. Never `~/.claude/plan.md`. Say which source you loaded.

If neither source exists — or the plan has no **Spec** section, no **Verification** section, and no per-task verification conditions — stop and tell the user:

> "No plan found — run `/plan-it` first or describe what done looks like."

Then get the changed files: `git diff --name-only origin/main...HEAD`.

## 2. Review and Verify

**Code review:** dispatch a fresh `superpowers:code-reviewer` subagent with the changed files and the plan, checking for bugs and logic errors, convention violations, security issues, test coverage gaps, and adherence to plan intent. Tell it the code may already have had a build-time review, so it should focus on the final state of the files. Never review your own work in this session; if subagents are unavailable, say so and review inline.

**Acceptance criteria:** take them from the plan's **Spec** items first, then its **Verification** section, then the per-task **Verify:** bullets (**Done when:** in older plans). For each criterion, find the code or output that addresses it, run something that confirms it, and mark it PASS, FAIL, or PARTIAL.

## 3. Fix

Fix the review findings and every FAIL/PARTIAL criterion, then re-run the checks that were failing. Escalate to the user only if a fix requires a decision the plan doesn't cover.

## 4. Report and Gate

Show the user:

- **Code review** — the findings and what you fixed, or "No issues found."
- **AC verification** — a table of criterion / PASS·FAIL·PARTIAL / evidence, reflecting the state after fixes.

Then **wait for explicit approval before opening the PR.** This is the one hard gate — do not commit-and-push your way past it.

## 5. Open the Draft PR

Commit any outstanding work in the repo's commit-message style and push, setting upstream if needed. If the branch has no commits ahead of main, stop and say there's nothing to ship.

Check the repo for a PR template and fill it in if one exists. Otherwise:

```
## Summary
<bullet points describing what changed and why>

## Test plan
<how to verify the changes>
```

Title comes from the branch and commit history, under 70 characters. Create it with `gh pr create --draft --base main` and print the URL.

## 6. Drive CI Green

Poll `gh pr checks`. On failure, read the logs (`gh run view <run-id> --log-failed`), find the root cause, batch all fixes into one commit, verify locally before pushing, and push. Repeat until every check passes — no iteration cap.

## 7. Mark Ready

`gh pr ready`, then summarize: PR title and URL, what it contains, and which checks failed and how you fixed them — or that CI passed on the first try.
