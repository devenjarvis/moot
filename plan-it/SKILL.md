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

The plan has two readers: a coding agent that will execute it end to end, and a human scanning it for correctness before approving. The human reads Goal, Spec, and the task names; the agent reads the per-task sub-bullets, and Context, Reuse and Risks are reference material it looks things up in. The reading view folds the second and third of those, so write each part for whoever actually reads it. Emit the sections the tier owes, in this order:

```
# Goal
<exactly one sentence: what the user is trying to accomplish>

## Spec
<numbered acceptance criteria, one line each, ~12 max — each a sentence that could become an assertion. No vague verbs ("handles", "supports") without a measurable subject. If you need more than ~12, the change is too large for one plan: split it and say so in Not In Scope.>

## Context
<one fact per bullet, one line each, ~10 max: what part of the system this touches, cited file:line, plus architectural constraints and local conventions ("this package uses table-driven tests")>

## Reuse
<one per bullet, one line each, ~8 max: existing helpers, types, and patterns to build on rather than recreate, cited by path or symbol. If nothing suitable exists, say so — the absence is a finding.>

## Risks
<one per bullet, one line each, ~8 max: architectural unknowns, external API contracts, concurrency hazards, tests that will need updating, and the load-bearing assumptions the building agent should probe early>

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

Context, Reuse and Risks are the exception to that no-word-cap principle, and they have caps for a different reason than padding. They are reference material — a bullet is a fact the building agent looks up, not an argument the reader works through — so each one stays a single scannable line and the section stays within its cap. A fact that needs a paragraph of justification is really a constraint on one task: put it in that task's `Implement:` or `Boundaries:`, where whoever acts on it will actually be looking. Cutting a real finding to hit a cap is the wrong trade; if a section genuinely needs more, the plan is too large and belongs split.

### 5. Render the Plan and Open It — Before the Approval Gate

Always, no exceptions, and *before* `ExitPlanMode`. The reader is being asked to approve this plan; they get to read it in the reading view first, and give feedback on it there:

```sh
mkdir -p "$PWD/.claude"
{skill-dir}/render-plan.sh --open --draft "<plan-mode plan file>" "$PWD/.claude/plan.html"
```

`{skill-dir}` is this skill's base directory, given to you when the skill loads — never a hardcoded user path. The source is the plan file plan mode gave you (`~/.claude/plans/<slug>.md`), which is the live document at this point. `mkdir -p` matters: in a fresh worktree there is no `.claude/` yet, and the renderer exits 2 on a missing output directory.

This writes a file during plan mode, which is deliberate and narrowly scoped. It is allowed: plan mode restricts the Write/Edit tools, and `render-plan.sh` is a shell script that writes through `mktemp`/`mv`. Nothing here touches the repo's source — `plan.html` is generated and `.claude/` is gitignored. Do not generalise it: `.claude/plan.md` is still written only after approval, in step 7.

`--draft` puts a "not yet approved" banner on the page, so a preview can't be mistaken for a signed-off plan — and so a `plan.html` newer than `plan.md` isn't read as authoritative. The re-render in step 7 drops it, which makes the banner going away the signal that approval landed.

`--open` opens the page in the default browser. Don't paste a `file://` URL and call it clickable — terminals generally only linkify web URLs, so such a link has to be copied by hand, which defeats the point. The script skips opening in a remote session and prints where the file is instead — in that case say the plan is reviewable at `.claude/plan.md` on the host, and don't wait on a page the reader can't see.

Then, on each round of feedback: edit the plan file, re-run the same command, and say what changed. The browser refocuses the existing tab, so revising is cheap and the reader stays on one page.

If the render fails, say so in one line and go to `ExitPlanMode` anyway. A missing reading view never blocks the gate — the plan is still reviewable as text, and step 7 renders it again.

### 6. Exit Plan Mode

`ExitPlanMode`. The reader has already seen the page, so this is the approval gate, not the first look.

### 7. Write the Handoff File, Then Re-render

Once approved: write the same plan content to `{worktree-root}/.claude/plan.md` — an absolute path from `pwd`, never `~/.claude/plan.md`. This is the cross-session handoff artifact build-it and ship-it read; skipping it breaks them in a fresh session. It stays uncommitted (`.claude/` is gitignored). It is written only now, never during plan mode: a `plan.md` for a plan the reader rejected would be picked up as real work by the next session.

Then re-render from it, without `--draft` and without `--open` — the page is already in front of them:

```sh
{skill-dir}/render-plan.sh "$PWD/.claude/plan.md" "$PWD/.claude/plan.html"
```

`plan.html` is generated: a single self-contained page that folds each task's agent-facing sub-bullets, and the Context, Reuse and Risks sections, so the goal, the criteria and the task names read at a glance. Never hand-edit it and never author the HTML yourself — the markdown is the source of truth and the script costs no tokens. Re-run the same command to refresh it after build-it ticks checkboxes.

### 8. Handoff to Execution

The reader has already reviewed and approved the page, so confirm rather than present:

> Approved plan is in `.claude/plan.html`, and `.claude/plan.md` for a fresh session.
> Say the word and I'll execute it.

Name the path as text so it's on record, and don't dress it up as a link. When the render failed, or the session is remote so the file isn't on the reader's machine, point at `.claude/plan.md` alone and don't apologize for it.

When the user accepts ("looks good", "do it", "go ahead", "execute", "yes", "ship it"), invoke the `build-it` skill via the Skill tool before writing any code.
