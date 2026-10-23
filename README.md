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

You review and approve the plan in the [`plan-review`](#plan-review) mod's pane, which replaces the built-in plan approval dialog.

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

- **Read** the plan section by section with **← Prev** / **Next →**, as an outline (`o`), or in full (`f`). Tables draw as aligned columns that keep each cell's bold, italic, strikethrough, `code` and links, and honour `:--:` alignment. Short one-line lists stay tight, while items with sub-points or code are spaced apart. Task boxes draw as ☐ and ☑.
- **Note** any section, or the plan as a whole. Notes save as you type.
- **Decide:** **1** approves, **2** sends your notes back to Claude as the `ExitPlanMode` error and keeps plan mode on, **3** (or Esc) falls back to the built-in dialog. Approving with unsent notes asks first. Pressing **2** with no notes opens a feedback box.

Approving skips the permission step, so Claude Code picks the mode that follows plan mode; the pane cannot choose it.

### `pr-status`

A mod that shows the GitHub PRs of the session's branches in a pane. The pane opens by itself the first time one of those branches has an open PR, and never before. Opened this way, it seats only on a terminal at least 144 columns wide; `/prs` opens it at any width.

- **Branches** it tracks: the branch checked out in the session's directory at start, and after every Bash command, `EnterWorktree` and directory change. It skips the default branch and a detached HEAD.
- **Stacks:** a PR in a [GitHub stack](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs) is drawn with the whole stack, top first, down to the base branch, including PRs whose branches the session never checked out. Without a native stack, PRs whose base is another PR's head are drawn as one stack too: the mod walks down to the PRs below the session's branches and up to the open PRs stacked on them, up to 5 levels each way.
- **Each PR** shows its number and title, check counts (`✓` passed, `✗` failed, `◷` running, each in its own color), the review decision, unresolved review threads, the size of the change, and `HEAD` on the branch you are on. On the right is the next thing it needs: `conflicts`, `checks failing`, `changes requested`, `checks pending`, `review needed`, `behind base`, or `ready to merge`.
- **Merging a stack:** merging a PR in a GitHub stack also merges the open PRs below it, so their problems count as its own. A PR whose own state is clean names the lowest problem below it in a dimmed shade of the problem's color (`↓ #19 review needed`), while its dot keeps its own state's color, or reads `ready · with #19` or `ready · merges #19–#21` when the whole range can land. In a stack without native stack data, you must merge from the bottom up, so the label reads `blocked by #N` until the PR below merges.
- **Act:** `r` refreshes; pressing a PR's title opens it in the browser.

It polls every 60 s while a PR is open and every 3 min otherwise, and 5 s after Claude runs `gh pr`, `gh stack` or `git push`. When every PR has merged or closed, the pane stays and shows the final state. If you close it, it stays closed until a new PR opens; a notice says `/prs` brings it back.

It needs [`gh`](https://cli.github.com), signed in. Without it, or outside a GitHub repo, the mod shows nothing.

### `rex-inbox`

A [Rex](https://www.superlogical.com/rex) script, not a Claude Code plugin. It lists every Claude Code agent in every Rex session in one pane, with the agents that need you at the top. It is made to sit in a narrow pane at the side.

```bash
rex do rex-inbox/inbox.lua --all
```

Run it in any Rex pane. It keeps the list current until you press Ctrl-C. `--all` is required: without it, the script hears only its own session.

- **Groups:** one group per session, headed by the session label and the agent's folder. Groups go in order of their most urgent agent. A session with agents in several folders names the folder on each agent instead.
- **Each agent** takes two lines: a number key, a state symbol, the terminal title, and how long ago the status changed, then the status message. A `blocked` agent also shows what it waits for: `[permission]`, `[question]`, or `[auth]`.
- **Order:** `▲ blocked`, then `✗ error`, then `✓ done`, then `◷ working`, then `○ idle`. Within `blocked`, `error`, and `done`, the oldest comes first. Within `working` and `idle`, the newest comes first.
- **Header:** counts per state, such as `2 blocked · 1 done · 4 working`.
- **Jump:** press `1`–`9` to go to that agent: the script focuses its pane and switches Rex to its session. Switching needs Remote Control, which you turn on in Rex's Settings under Rex Server. While it is off, the inbox shows a notice instead.
- **Other programs:** add `all=true` to list status from every program, not only Claude Code: `rex do rex-inbox/inbox.lua --all all=true`.

It reads the [Program Status](https://www.superlogical.com/rex/docs/build/program-status) records that Claude Code reports to Rex, so it shows only agents that run inside Rex. Lines never wrap: each is cut to the pane's width, and the list redraws within a second of a resize.

Test the model outside Rex with `luajit rex-inbox/test/model_test.lua`.

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
  rex-inbox/
    inbox.lua                # Rex script: snapshots, events, key reader, drawing
    model.lua                # Picking, sorting, grouping, and drawing rows (no Rex calls)
    test/model_test.lua      # Tests for the model, run with luajit
```

## License

MIT
