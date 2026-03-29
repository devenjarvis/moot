# ship-it Skill Design

## Purpose

A standalone skill that takes committed work on a branch and ships it through the PR pipeline: draft PR, CI check monitoring, automated failure fixing, and marking ready for review.

## Trigger

Invoked via `/ship-it`. Also suggested by the `execute` skill upon completion.

## Flow

### Step 1 — Prepare

- Stage all unstaged changes
- Inspect changes via `git status`, `git diff`, and `git log`
- Commit with a clear message following repo conventions
- Push to remote, setting upstream if needed

### Step 2 — Open Draft PR

- Check for a PR template in the repo (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/pull_request_template.md`, or a `.github/PULL_REQUEST_TEMPLATE/` directory)
- Auto-generate PR title from branch name and commit history
- Auto-generate PR description using the repo's template if found, otherwise a default format (summary of changes + test plan)
- Target the `main` branch
- Open as draft via `gh pr create --draft`

### Step 3 — Poll-Fix Loop

- Poll `gh pr checks` until all checks reach a terminal state (no pending checks remain)
- If all checks pass, proceed to Step 4
- If any checks fail:
  - Read failure logs via `gh` CLI to diagnose
  - Fix all failures as a batch
  - Commit the fixes and push
  - Return to the top of the loop and re-poll
- No iteration cap — continue until all checks pass

### Step 4 — Mark Ready and Report

- Run `gh pr ready` to take the PR out of draft
- Print a summary to the user in the Claude session:
  - What the PR contains
  - Which checks failed and how they were fixed (if any)
  - The PR URL

## Integration with Execute

The `execute` skill's "Complete" section commits the work, then tells the user: "When you're ready to open a PR, run `/ship-it`."

## Design Decisions

- **Batch fixes over per-fix pushes**: Fewer CI runs, fixes that interact get tested together.
- **No iteration cap**: The user wants it to keep going until it works.
- **Auto-generate PR metadata**: Uses repo PR template when available, generates sensible defaults otherwise.
- **Always targets main**: No branch selection prompt.
- **Summary stays in session**: No comments posted on the PR itself.
- **Commits unstaged work**: Assumes the user may have uncommitted changes when invoking.
