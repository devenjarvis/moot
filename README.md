# moot

A set of [Claude Code](https://docs.anthropic.com/en/docs/claude-code) custom skills for the LLM-first product development lifecycle. Moot separates product intent from technical planning from execution — each step producing an artifact the right person can validate.

## Skills

### `/spec-it`

Guides a product manager through a conversation to produce a Capability Card — the atomic unit of work in an LLM-first PDLC. Replaces the traditional Jira ticket with a structured spec that product can validate and engineering can plan from.

**Trigger phrases:** "write a ticket", "create a spec", "define the requirements", "help me write this up", or `/spec-it`

A Capability Card contains exactly what LLMs need to plan correctly:

| Section | Owner | Purpose |
|---------|-------|---------|
| Problem statement | Product | Who is affected and what's broken |
| Acceptance criteria | Product | Observable, product-validatable outcomes |
| Constraints | Product | What must NOT change |
| Out of scope | Product | What is explicitly excluded |

The skill asks clarifying questions in product language — never generating technical decisions product can't validate. The acceptance criteria from the card feed directly into `/plan-it`'s Verification section, giving both sides a shared source of truth.

### `/plan-it`

Turns a user request into a structured implementation plan, scaled to the complexity of the work.

**Trigger phrases:** "plan this", "how should we build", "let's think through", or `/plan-it`

The plan skill classifies work into three tiers and adjusts its depth accordingly:

| Complexity | Exploration | Questions | Approaches | User Gate |
|------------|-------------|-----------|------------|-----------|
| Trivial    | Glance      | None      | None       | No        |
| Moderate   | Targeted    | Batched   | None       | No        |
| Complex    | Deep        | Batched   | 2-3 options| Yes       |

Plans are written to Claude Code's built-in plan file (not separate documents in your repo) and include:
- Tasks with intent, file paths, and boundaries
- Parallelism annotations for independent work
- PR boundary recommendations

Every plan is also written to `.claude/plan.md` in the worktree root — an uncommitted handoff artifact so `/build-it` and `/ship-it` can pick the work up in a fresh session.

### `/build-it`

Takes an implementation plan and runs it — dispatching parallel subagents for independent tasks, following TDD, and running code review before shipping.

**Trigger phrases:** "execute", "build this", "implement the plan", or `/build-it`

The build-it skill handles:
- **Plan validation** — checks that file paths and dependencies are still valid
- **Stacked PR detection** — proposes stacked PRs when tasks span independent concerns
- **TDD execution** — tests first, then implementation, for each task
- **Parallel dispatch** — independent tasks run as subagents using a structured implementer prompt
- **Automated code review** — dispatches a reviewer subagent before shipping
- **Escalation** — stops and asks when requirements are ambiguous or scope grows unexpectedly

Build-it never opens the PR itself — it hands off to `/ship-it`.

### `/ship-it`

The gate between a finished implementation and a merged PR: validate → fix → approve → PR → CI. (This skill absorbed the former `/validate-it`, so the review and the ship are one step instead of two.)

**Trigger phrases:** "validate it", "run validation", "ship it", "open a PR", or `/ship-it`

1. **Validate** — a fresh reviewer subagent reviews the changed files, and each acceptance criterion from the plan's Verification section (or the tasks' "Done when" conditions) is checked and marked PASS, FAIL, or PARTIAL
2. **Fix** — findings and failing criteria are fixed automatically, then re-verified
3. **Gate** — you get the review findings and the AC table, and nothing is pushed until you approve
4. **PR** — commits, pushes, and opens a draft PR, filling in the repo's PR template if it has one
5. **CI** — polls checks, diagnoses failures, pushes fixes, and repeats until green, then marks the PR ready for review

## Installation

Clone the repo and add the skill directories to your Claude Code configuration:

```bash
git clone https://github.com/devenjarvis/moot.git
```

Then register the skills in your Claude Code project or user settings. See the [Claude Code custom skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills) for details on configuring custom skill directories.

## Project Structure

```
moot/
  spec-it/
    SKILL.md          # Capability-card skill definition
  plan-it/
    SKILL.md          # Plan-it skill definition
  build-it/
    SKILL.md          # Build-it skill definition
    implementer-prompt.md  # Template for subagent dispatch
  ship-it/
    SKILL.md          # Ship-it skill definition (validate + PR + CI)
```

## License

MIT
