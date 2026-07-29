---
name: plan-it
description: Use BEFORE implementation for any non-trivial task when no plan exists in context — feature requests, multi-file changes, architecture decisions, refactors, or any change where jumping straight to code would be premature. Check this skill before build-it. Triggered by "add X", "implement X", "build X", "let's add", "how should we", "plan this", "let's think through", or /plan-it.
---

# Plan It

Turn a user request into an implementation plan scaled to its complexity.

### 1. Assess Complexity

Classify the request silently. The tier sets the depth of every step that follows:

| Complexity | Explore | Questions | Approaches | User Gate | Sections it owes |
|-----------|---------|-----------|------------|-----------|------------------|
| **Trivial** — single file, obvious change | Glance at the target file | None | None | No | Goal, Spec, Tasks, Verification, Not In Scope |
| **Moderate** — 2–5 files, some design decisions | Target files + immediate dependencies, existing patterns | Batched into one round | None | No | Those plus Context, Reuse, Risks |
| **Complex** — cross-cutting, architectural | Deep; Explore agents in parallel, map the dependency graph | Batched into one round | 2–3 with tradeoffs and a recommendation | Yes | All of them, in depth |

### 2. Explore

Explore existing patterns first — the codebase already has conventions, and the plan should follow them. Then re-check the classification: if exploration surfaced more interconnections, unknowns, or design decisions than the request suggested, upgrade the tier and pick up the steps that tier requires.

### 3. Clarify (moderate+)

Use `AskUserQuestion` for what you genuinely can't answer from the codebase. For complex work, one question should be approach selection, with previews showing the key difference between options. One or two questions is fine.

### 4. Write the Plan

Use `EnterPlanMode` to write the plan to Claude's built-in plan file. Do not create separate plan documents in the repo.

The plan has two readers: a coding agent that will execute it end to end, and a human scanning it for correctness before approving. The human reads Goal, Spec, and the task names; the agent reads the per-task sub-bullets. Emit the sections the tier owes, in this order:

```
# Goal
<exactly one sentence: what the user is trying to accomplish>

## Spec
<numbered acceptance criteria, one line each, ~12 max — each a sentence that could become an assertion. No vague verbs ("handles", "supports") without a measurable subject. If you need more than ~12, the change is too large for one plan: split it and say so in Not In Scope.>

## Context
<one fact per bullet: what part of the system this touches, cited file:line, plus architectural constraints and local conventions ("this package uses table-driven tests")>

## Reuse
<existing helpers, types, and patterns to build on rather than recreate, cited by path or symbol. If nothing suitable exists, say so — the absence is a finding.>

## Risks
<architectural unknowns, external API contracts, concurrency hazards, tests that will need updating, and the load-bearing assumptions the building agent should probe early>

## Tasks

- [ ] <imperative short phrase — "Add --json flag to doctor", not a paragraph>
  - Files: path/to/file.ts:42, path/to/other.ts:88
  - Signatures: <the new or changed signature — omit this bullet entirely if none>
  - Test first: <failing test to write, its path, the case it covers, and the expected failure>
  - Implement: <1–3 sentences on the production change>
  - Verify: <command that must pass and what confirms it — or "manual: <specific check>">
  - Boundaries: <what this task does NOT touch>

- [ ] <next task>

## Parallelism
- Tasks [X, Y] are independent — can run as parallel subagents
- Task Z depends on X completing first

## PR Boundaries
<where to split when the work spans independent concerns, or "Ship as one PR">

## Verification
<end-to-end checks once every task is done: concrete commands and expected outcomes, not prose>

## Not In Scope
<what this plan deliberately excludes — name the slice you're cutting and why>
```

Plan principles: tasks describe intent and boundaries, never step-by-step code; cite `file:line` in Context and in each task's `Files:`, not bare paths; `- [ ]` checkboxes appear only inside Tasks, and sub-bullets are plain two-space-indented `  - ` lines; every task is test-first, and a task with no meaningful test says so explicitly in `Verify:` rather than omitting verification; no placeholder language — "TBD", "similar to task N", "appropriate error handling", "as needed"; there is no word cap for moderate and complex plans, since length comes from completeness, not padding; YAGNI — plan what was asked, not what might be needed later.

Then `ExitPlanMode`.

### 5. Write the Handoff File, Then Render It

Always, no exceptions. Write the same plan content to `{worktree-root}/.claude/plan.md` — an absolute path from `pwd`, never `~/.claude/plan.md`. This is the cross-session handoff artifact build-it and ship-it read; skipping it breaks them in a fresh session. It stays uncommitted (`.claude/` is gitignored).

Then render the reading view:

```sh
{skill-dir}/render-plan.sh "$PWD/.claude/plan.md" "$PWD/.claude/plan.html"
```

`{skill-dir}` is this skill's base directory, given to you when the skill loads — never a hardcoded user path. Both writes happen here, after `ExitPlanMode`, because plan mode permits no writes outside Claude's plan file.

`plan.html` is generated: a single self-contained page that collapses each task's agent-facing sub-bullets so the human-facing names read at a glance. Never hand-edit it and never author the HTML yourself — the markdown is the source of truth and the script costs no tokens. Re-run the same command to refresh it after build-it ticks checkboxes.

If the render fails, say so in one line and carry on with `plan.md`. A missing reading view never blocks the handoff.

### 6. Handoff to Execution

Hand over the link, since the terminal is the worse place to read a plan:

> Plan ready — read it here: file:///absolute/path/to/.claude/plan.html
> Say the word and I'll execute it.

Print the absolute `file://` URL so it is clickable, and don't open a browser. For complex work, wait for confirmation before proceeding; otherwise that line is the whole handoff. When the render failed, or the session is remote or containerized so the file isn't on the reader's machine, point at `.claude/plan.md` instead and don't apologize for it.

When the user accepts ("looks good", "do it", "go ahead", "execute", "yes", "ship it"), invoke the `build-it` skill via the Skill tool before writing any code.
