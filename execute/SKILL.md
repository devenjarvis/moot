---
name: execute
description: Use when there is an implementation plan ready to execute — either from the plan skill, a user-provided plan, or an existing plan file. Triggered by "execute", "build this", "implement the plan", or /execute.
---

# Execute

Execute an implementation plan. Load it, run it, ship it.

## Process

### 1. Load and Sanity Check

Read the plan from Claude's built-in plan file (or from wherever the user points you).

Quick sanity check:
- Are file paths still valid? (files may have changed since planning)
- Are there obvious conflicts with current code state?
- Do task dependencies make sense?

If something is off, flag it briefly and adjust. Don't re-plan from scratch.

### 2. Detect Stacked PR Opportunity

Check if the plan should ship as stacked PRs. Heuristic — propose stacking when ALL of:
- Tasks span 2+ independent concerns
- File sets don't overlap between concerns
- Total change likely exceeds ~500 lines
- Each concern is independently reviewable

If stacking applies, propose it to the user: "This looks like it could stack as [PR1: description] -> [PR2: description]. Want to stack, or ship as one?"

If the user declines or it doesn't apply, ship as one PR.

### 3. Execute Tasks

Follow TDD for each task: write/update tests first, verify they fail, implement, verify they pass.

**For independent tasks (marked parallel in plan):**
Dispatch subagents using the Agent tool. Each subagent gets the implementer prompt from `./implementer-prompt.md` filled with:
- Task description and context from the plan
- Relevant file paths and constraints
- What "done" looks like

**For sequential/dependent tasks:**
Execute inline in the main conversation. Work through each task, verify it works before moving to the next.

**After each task or parallel group:**
- Verify the work: run tests, check types, confirm behavior
- If a task fails verification, fix it before proceeding
- Update plan progress (mark tasks complete)

### 4. Review

Dispatch a fresh subagent (using `subagent_type: "superpowers:code-reviewer"` or `"feature-dev:code-reviewer"`) for review — never review your own work in the originating session. The reviewer gets:
- The plan (what was intended)
- The list of changed files
- Instructions to check: plan intent match, test coverage, bugs, security issues, pattern adherence

Fix issues the reviewer surfaces, then re-review with a fresh subagent if fixes were non-trivial.

### 5. Complete

**Commit:**
- Stage and commit logical units of work
- Write clear commit messages

**PR(s):**
- If stacking: create draft PRs in dependency order, each branching from the previous
- If single: create one draft PR
- PR description should summarize what changed and why
- Always create PRs as drafts (`gh pr create --draft`)

**Final verification:**
- Run the full test suite one more time
- Report results to the user

## Escalation

Stop and ask the user when:
- Requirements are ambiguous and the plan doesn't resolve it
- Tests fail in non-obvious ways (not just a typo fix)
- Scope is larger than the plan anticipated
- You discover a design decision the plan didn't address

Don't stop for:
- Minor implementation choices the plan already decided
- Standard error handling
- Import organization or formatting

## Stacked PR Mechanics

When stacking:
1. Create a branch for PR1, implement, commit, push
2. Branch PR2 off PR1's branch, implement, commit, push
3. Create draft PR1 targeting main
4. Create draft PR2 targeting PR1's branch
5. Note the dependency in each PR description
