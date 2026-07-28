---
name: build-it
description: Use when there is an implementation plan ready to execute — either from the plan-it skill, a user-provided plan, or an existing plan file. Triggered by "execute", "build this", "implement the plan", or /build-it.
---

# Build It

Execute an implementation plan.

## 1. Load the Plan

Read `{worktree-root}/.claude/plan.md`, falling back to the in-session plan context, or wherever the user points you. Never `~/.claude/plan.md`.

Sanity check it against the current code: are the file paths still valid, do the task dependencies still make sense, does anything conflict with what's on disk now? Flag what's off and adjust — don't re-plan from scratch.

## 2. Detect Stacked PR Opportunity

Propose stacking when all four hold: tasks span 2+ independent concerns, file sets don't overlap between them, the total change likely exceeds ~500 lines, and each concern is independently reviewable.

Ask: "This looks like it could stack as [PR1: description] -> [PR2: description]. Want to stack, or ship as one?" Otherwise ship as one PR.

When stacking, each PR branches off and targets the one below it, with the dependency noted in its description.

## 3. Execute Tasks

TDD for every task: tests first, watch them fail for the right reason, implement, watch them pass.

Tasks the plan marks independent go to parallel subagents via the Agent tool, each dispatched with `./implementer-prompt.md` filled in from the plan. Sequential and dependent tasks run inline.

After each task or parallel group, verify before moving on — run the tests, check types, confirm the behavior. Fix a failure before proceeding.

As each task verifies, tick its `- [ ]` to `- [x]` in `{worktree-root}/.claude/plan.md` so a fresh session can see what already landed. Only the dispatching session writes that file — implementer subagents never touch it, or concurrent writes will corrupt it.

## 4. Review

Dispatch a fresh subagent (`subagent_type: "superpowers:code-reviewer"` or `"feature-dev:code-reviewer"`) with the plan, the changed files, and instructions to check plan-intent match, test coverage, bugs, security issues, and pattern adherence.

**Never review your own work in the originating session.** Fix what the reviewer surfaces, then re-review with a fresh subagent if the fixes were non-trivial.

## 5. Complete

Commit logical units of work with clear messages, run the full test suite once more, and report the results.

Then hand off: "Implementation complete. Run `/ship-it` to validate, fix, and open a PR."

Do not create the PR yourself — that's ship-it's job.

## Escalation

Stop and ask the user when requirements are ambiguous and the plan doesn't resolve it, when tests fail in non-obvious ways, when scope turns out larger than the plan anticipated, or when you hit a design decision the plan didn't address.
