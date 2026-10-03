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

Once you approve a plan it is also written to `.claude/plan.md` in the worktree root — an uncommitted handoff artifact so `/build-it` and `/ship-it` can pick the work up in a fresh session. It is written only on approval: a `plan.md` for a plan you rejected would be picked up as real work by the next session.

`plan-it` generates `.claude/plan.html` and opens it in your browser **before** asking you to approve — you review the plan in the reading view and give feedback there, and each round of feedback re-renders the same page. Until you approve, the page carries a "not yet approved" draft banner; approving re-renders it without one, so the banner going away is the signal that the plan landed.

Plans are dense to review in a terminal, and the density is structural: the task sub-bullets (`Files:`, `Test first:`, `Verify:`, …) are written for the coding agent, not for you, so they take most of the vertical space on a surface where everything is weighted equally. Context, Reuse and Risks are the same — reference material the building agent looks things up in. The HTML view folds both out of the way: task sub-bullets behind each task's name, and those three sections behind their own headings, leaving the goal, the acceptance criteria and the task names to read at a glance. What you are checking for correctness stays open. It also sets each task's `Files:`/`Verify:`/`Boundaries:` sub-bullets as a two-column field table, and adds a sticky section index, a task count taken from the `- [x]` counts, and `file:line` chips — and prints cleanly, with everything folded opened for the printout and put back afterwards. The count only grows a progress bar while a plan is part-done: a 0% bar at review time is noise, and since the page is not re-rendered as work lands, a full one would mostly mean "rendered after the fact".

It opens the page rather than printing a `file://` link because terminals generally only linkify web URLs — Ghostty and Terminal.app both leave `file://` inert, so a printed link has to be copy-pasted, which is exactly the friction this is meant to remove. Pass `--open` to opt in; the script skips it in a remote session and tells you where the file is instead.

It is a **generated read-only view**; the markdown is the source of truth. Nothing is ever hand-edited into the HTML, and no plan content passes through the model a second time to produce it — `render-plan.sh` is a shell concatenation of three templates, the plan source, and a vendored copy of [marked](https://github.com/markedjs/marked) (MIT, pinned in `plan-it/assets/MARKED-LICENSE.md`). The page opens with no network access.

Because it is generated, it goes stale as `/build-it` ticks checkboxes. Refresh it whenever you like:

```bash
plan-it/render-plan.sh .claude/plan.md .claude/plan.html
```

Full usage is `render-plan.sh [--open] [--draft] <plan.md> <out.html>`; `--draft` is what stamps the page as not yet approved. The same script renders any plan markdown, including the archived plans under `~/.claude/plans/`.

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

## Mods

### `plan-review`

A Claude Code mod (a plugin of function hooks) that replaces the built-in plan approval dialog with a review pane. When Claude calls `ExitPlanMode`, the pane opens on the plan's first section, and the built-in dialog does not show.

- **Read** the plan section by section with **← Prev** / **Next →**, as an outline (`o`), or in full (`f`). Tables draw as aligned columns, and list items are spaced apart.
- **Note** any section, or the plan as a whole. Notes save as you type.
- **Decide:** **1** approves, **2** sends your notes back to Claude as the `ExitPlanMode` error and keeps plan mode on, **3** (or Esc) falls back to the built-in dialog. Approving with unsent notes asks first. Pressing **2** with no notes opens a feedback box.

Approving skips the permission step, so Claude Code picks the mode that follows plan mode; the pane cannot choose it.

### `pr-status`

A mod that shows the GitHub PRs of the session's branches in a pane. The pane opens by itself the first time one of those branches has an open PR, and never before. Opened this way, it seats only on a terminal at least 144 columns wide; `/prs` opens it at any width.

- **Branches** it tracks: the branch checked out in the session's directory at start, and after every Bash command, `EnterWorktree` and directory change. It skips the default branch and a detached HEAD.
- **Stacks:** a PR in a [GitHub stack](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs) is drawn with the whole stack, top first, down to the base branch, including PRs whose branches the session never checked out. Without a native stack, PRs whose base is another PR's head are drawn as one stack too.
- **Each PR** shows its number and title, check counts (`✓` passed, `✗` failed, `◷` running, each in its own color), the review decision, unresolved review threads, the size of the change, and `HEAD` on the branch you are on. On the right is the next thing it needs: `conflicts`, `checks failing`, `changes requested`, `checks pending`, `review needed`, `behind base`, or `ready to merge`.
- **Merging a stack:** merging a PR in a GitHub stack also merges the open PRs below it, so their problems count as its own. A PR whose own state is clean names the lowest problem below it in a dimmed shade of the problem's color (`↓ #19 review needed`), while its dot keeps its own state's color, or reads `ready · with #19` or `ready · merges #19–#21` when the whole range can land. In a stack without native stack data, you must merge from the bottom up, so the label reads `blocked by #N` until the PR below merges.
- **Act:** `r` refreshes; pressing a PR's title opens it in the browser.

It polls every 60 s while a PR is open and every 3 min otherwise, and 5 s after Claude runs `gh pr`, `gh stack` or `git push`. When every PR has merged or closed, the pane stays and shows the final state. If you close it, it stays closed until a new PR opens; a notice says `/prs` brings it back.

It needs [`gh`](https://cli.github.com), signed in. Without it, or outside a GitHub repo, the mod shows nothing.

## Installation

Clone the repo and add the skill directories to your Claude Code configuration:

```bash
git clone https://github.com/devenjarvis/moot.git
```

Then register the skills in your Claude Code project or user settings. See the [Claude Code custom skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills) for details on configuring custom skill directories.

To load the mods in every session, point `CLAUDE_CODE_PLUGIN_DIRS` at their folders in the `env` block of `~/.claude/settings.json` (use the path of your clone):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/Code/moot/plan-review:~/Code/moot/pr-status"
  }
}
```

Separate several folders with `:` (`;` on Windows). To try it for one session only, run `claude --plugin-dir ~/Code/moot/plan-review`. A `git pull` updates it.

Check a mod with `claude plugin validate <folder>` and `claude plugin test <folder>`.

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
  plan-review/
    .claude-plugin/plugin.json  # Mod manifest
    hooks/
      hooks.json             # Names the hooks module
      register.tsx           # Hooks and the review pane
      plan.ts                # Plan parsing, block splitting, feedback text
      plan-review.test.tsx   # Tests for `claude plugin test`
    types/index.d.ts         # The mod's $.state contract
    tsconfig.json            # Extends the types Claude Code writes on load
  pr-status/
    .claude-plugin/plugin.json  # Mod manifest
    hooks/
      hooks.json             # Names the hooks module
      register.tsx           # Branch tracking, polling, and the PR pane
      github.ts              # GraphQL query, parsing, stack grouping, next step
      github.test.ts         # Tests for the pure GitHub logic
      pr-status.test.tsx     # Tests for the hooks and the pane
    types/index.d.ts         # The mod's $.state contract
    tsconfig.json            # Extends the types Claude Code writes on load
```

## License

MIT
