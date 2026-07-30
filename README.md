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

Plans are written to Claude Code's built-in plan file (not separate documents in your repo). A full plan carries ten sections — Goal, Spec, Context, Reuse, Risks, Tasks, Parallelism, PR Boundaries, Verification, Not In Scope — and lighter tiers emit a subset: a trivial plan is just Goal, Spec, Tasks, Verification, and Not In Scope, while a moderate one adds Context, Reuse, and Risks.

Tasks are checkboxes, each carrying the files it touches (cited `file:line`), the test to write first, the change to make, how to verify it, and what it must not touch. `/build-it` ticks the boxes as it goes, so the plan doubles as a progress ledger across sessions.

Every plan is also written to `.claude/plan.md` in the worktree root — an uncommitted handoff artifact so `/build-it` and `/ship-it` can pick the work up in a fresh session.

Alongside it, `plan-it` generates `.claude/plan.html` and opens it in your browser. Plans are dense to review in a terminal, and the density is structural: the task sub-bullets (`Files:`, `Test first:`, `Verify:`, …) are written for the coding agent, not for you, so they take most of the vertical space on a surface where everything is weighted equally. The HTML view collapses them behind each task's name, sets each task's `Files:`/`Verify:`/`Boundaries:` sub-bullets as a two-column field table, and adds a sticky section index, a task count taken from the `- [x]` counts, and `file:line` chips — and prints cleanly. The count only grows a progress bar while a plan is part-done: a 0% bar at review time is noise, and since the page is not re-rendered as work lands, a full one would mostly mean "rendered after the fact".

It opens the page rather than printing a `file://` link because terminals generally only linkify web URLs — Ghostty and Terminal.app both leave `file://` inert, so a printed link has to be copy-pasted, which is exactly the friction this is meant to remove. Pass `--open` to opt in; the script skips it in a remote session and tells you where the file is instead.

It is a **generated read-only view**; the markdown is the source of truth. Nothing is ever hand-edited into the HTML, and no plan content passes through the model a second time to produce it — `render-plan.sh` is a shell concatenation of three templates, the plan source, and a vendored copy of [marked](https://github.com/markedjs/marked) (MIT, pinned in `plan-it/assets/MARKED-LICENSE.md`). The page opens with no network access.

Because it is generated, it goes stale as `/build-it` ticks checkboxes. Refresh it whenever you like:

```bash
plan-it/render-plan.sh .claude/plan.md .claude/plan.html
```

The same script renders any plan markdown, including the archived plans under `~/.claude/plans/`.

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

1. **Validate** — a fresh reviewer subagent reviews the changed files, and each acceptance criterion from the plan's Spec items (falling back to its Verification section, then the tasks' `Verify:` bullets) is checked and marked PASS, FAIL, or PARTIAL
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
    render-plan.sh    # Renders a plan markdown file to one self-contained HTML page
    assets/
      template-head.html   # Page shell, stylesheet, and the plan-aware layer
      template-mid.html    # Seam between the plan source and the parser
      template-tail.html   # Closing tags
      marked.umd.js        # Vendored markdown parser (MIT)
      MARKED-LICENSE.md    # Pinned version, checksum, and license
    test/
      fixture-plan.md      # Plan exercising every construct the renderer must survive
      render-test.sh       # Assertions that need no browser
      dom-test.mjs         # Behavioral assertions run in a real DOM, when jsdom is reachable
  build-it/
    SKILL.md          # Build-it skill definition
    implementer-prompt.md  # Template for subagent dispatch
  ship-it/
    SKILL.md          # Ship-it skill definition (validate + PR + CI)
```

## License

MIT
