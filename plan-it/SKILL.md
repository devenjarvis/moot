---
name: plan-it
description: Use BEFORE implementation for any non-trivial task when no plan exists in context — feature requests, multi-file changes, architecture decisions, refactors, or any change where jumping straight to code would be premature. Check this skill before build-it. Triggered by "add X", "implement X", "build X", "let's add", "how should we", "plan this", "let's think through", or /plan-it.
---

# Plan It

Turn a user request into an implementation plan scaled to its complexity.

### 1. Assess Complexity

Classify the request silently. The tier sets the depth of every step that follows:

| Complexity | Explore | Questions | Approaches | User Gate |
|-----------|---------|-----------|------------|-----------|
| **Trivial** — single file, obvious change | Glance at the target file | None | None | No |
| **Moderate** — 2–5 files, some design decisions | Target files + immediate dependencies, existing patterns | Batched into one round | None | No |
| **Complex** — cross-cutting, architectural | Deep; Explore agents in parallel, map the dependency graph | Batched into one round | 2–3 with tradeoffs and a recommendation | Yes |

### 2. Explore

Explore existing patterns first — the codebase already has conventions, and the plan should follow them. Then re-check the classification: if exploration surfaced more interconnections, unknowns, or design decisions than the request suggested, upgrade the tier and pick up the steps that tier requires.

### 3. Clarify (moderate+)

Use `AskUserQuestion` for what you genuinely can't answer from the codebase. For complex work, one question should be approach selection, with previews showing the key difference between options. One or two questions is fine.

### 4. Write the Plan

Use `EnterPlanMode` to write the plan to Claude's built-in plan file. Do not create separate plan documents in the repo.

```
## [Feature/Change Name]

### Context
[1-3 sentences: what and why]

### Tasks

#### Task 1: [intent, not implementation detail]
- **Files:** exact paths
- **What:** what this task accomplishes
- **Done when:** [concrete, checkable condition]
- **Boundaries:** what this task does NOT touch
- **Constraints:** patterns to follow, edge cases to handle

#### Task 2: ...

### Not In Scope
<!-- List what this plan explicitly excludes — things that might seem related but won't be touched -->

### Assumptions
<!-- List what must be true for this plan to be valid — existing functions, field nullability, service behavior, etc. -->

### Parallelism
- Tasks [X, Y] are independent — can run as parallel subagents
- Task Z depends on X completing first

### PR Boundaries
- [If multi-concern: where to split PRs]
- [Single concern: "Ship as one PR"]

### Verification
<!-- End-to-end steps to confirm the implementation is correct: commands to run, paths to test, observable outcomes -->
```

Plan principles: tasks describe intent and boundaries, never step-by-step code; every task lists exact file paths; no inline code snippets; annotate what can parallelize; mark PR boundaries when work spans independent concerns; YAGNI — plan what was asked, not what might be needed later.

Then `ExitPlanMode`.

### 5. Write the Handoff File

Always, no exceptions. Write the same plan content to `{worktree-root}/.claude/plan.md` — an absolute path from `pwd`, never `~/.claude/plan.md`. This is the cross-session handoff artifact build-it and ship-it read; skipping it breaks them in a fresh session. It stays uncommitted (`.claude/` is gitignored).

### 6. Handoff to Execution

For complex work, present the plan summary and wait for confirmation. Otherwise tell the user: "Plan ready. Say the word and I'll execute it."

When the user accepts ("looks good", "do it", "go ahead", "execute", "yes", "ship it"), invoke the `build-it` skill via the Skill tool before writing any code.
