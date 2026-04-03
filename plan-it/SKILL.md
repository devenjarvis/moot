---
name: plan-it
description: Use when the user needs to plan work before implementation — feature requests, multi-file changes, architecture decisions, or any task where jumping straight to code would be premature. Triggered by "plan this", "how should we build", "let's think through", or /plan-it.
---

# Plan It

Turn a user request into an implementation plan scaled to its complexity.

## Process

### 1. Assess Complexity

Read the request. Classify silently:

- **Trivial** (single file, obvious change): skip to writing plan, no questions needed
- **Moderate** (2-5 files, some design decisions): explore briefly, batch all clarifying questions into one message
- **Complex** (cross-cutting, multiple concerns, architectural): explore thoroughly, propose 2-3 approaches with tradeoffs and a recommendation, get user confirmation before writing plan

### 2. Explore

Read the files that matter. Check existing patterns, conventions, and dependencies. Scale depth to complexity:

- **Trivial**: glance at the target file
- **Moderate**: read target files + immediate dependencies, check for existing patterns
- **Complex**: use Explore agents for parallel investigation of different areas. Map the dependency graph. Understand the architecture before proposing anything

Always explore existing patterns first. The codebase already has conventions — follow them.

After exploring, re-check your complexity classification. If the exploration reveals more interconnections, unknowns, or design decisions than initially apparent, upgrade the classification and adjust accordingly (e.g., trivial → moderate means run clarifying questions before writing the plan; moderate → complex means propose approaches and wait for confirmation).

### 3. Clarify (moderate+ only)

Use `AskUserQuestion` to present structured, interactive questions. Batch up to 4 questions per call. Use `multiSelect: true` when choices aren't mutually exclusive. Put your recommended option first with "(Recommended)" in the label. Add descriptions to each option explaining tradeoffs.

For complex work, one of the questions should be approach selection with `preview` fields showing the key difference (e.g. architecture sketch, API shape, file structure).

Example structure:
- Q1 (header: "Approach"): 2-3 approach options with descriptions and previews. Recommended first.
- Q2 (header: "Scope", multiSelect): which optional concerns to include
- Q3 (header: "Testing"): testing strategy preference
- Q4: any remaining open question

Adapt the questions to what you actually need to know — don't ask questions you can answer from the codebase. If you only have 1-2 questions, that's fine.

### 4. Write Plan

Use `EnterPlanMode` to write the plan to Claude's built-in plan file. Do NOT create separate plan documents in the repo.

**Plan format:**

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
- [Split: PR1 covers X, PR2 covers Y] OR [Ship as one PR]

### Verification
<!-- End-to-end steps to confirm the implementation is correct: commands to run, paths to test, observable outcomes -->
```

Then `ExitPlanMode` when done.

**PR-split criteria:**

Split into multiple PRs when ANY of these are true:
- **Mixed concerns**: structural change (rename/refactor/reorganize) mixed with new behavior
- **Independent utility**: Part A is useful/mergeable without Part B
- **Risk asymmetry**: one part is safe/routine, another is experimental or high-risk
- **Unblocking**: Part A unblocks a teammate and doesn't need to ship with Part B
- **Size**: a single PR would exceed ~500 lines of substantive logic

Otherwise, keep as one PR when:
- All tasks serve the same feature or fix
- Tasks are sequentially dependent (B is meaningless without A)
- Splitting would leave the repo in a partial/broken state

**Plan principles:**
- Tasks describe intent and boundaries, not step-by-step code
- Every task lists exact file paths
- No inline code snippets in the plan
- Annotate which tasks can parallelize
- Apply PR-split criteria (above) to determine boundaries
- Include verification steps
- YAGNI — plan what was asked, not what might be needed later

### 5. User Gate (complex only)

For complex work, present the plan summary and wait for confirmation before the user moves to execution. For trivial/moderate, the plan is ready to execute immediately.

### 6. Handoff to Execution

After the plan is written, tell the user: "Plan ready. Say the word and I'll execute it."

When the user accepts (e.g. "looks good", "do it", "go ahead", "execute", "yes", "ship it"), invoke the `build-it` skill via the Skill tool before writing any code.

## Quick Reference

| Complexity | Explore | Questions | Approaches | User Gate |
|-----------|---------|-----------|------------|-----------|
| Trivial   | Glance  | None      | None       | No        |
| Moderate  | Targeted| Batched   | None       | No        |
| Complex   | Deep    | Batched   | 2-3 options| Yes       |
