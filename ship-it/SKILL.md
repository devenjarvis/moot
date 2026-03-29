---
name: ship-it
description: >
  Open a draft PR, monitor CI checks, fix failures, and mark ready for review.
  Use when implementation is complete and you want to ship via PR. Triggered by
  "ship it", "open a PR", or /ship-it.
---

# Ship It

Ship the current branch through the PR pipeline: commit, draft PR, fix CI, mark ready.

**Announce at start:** "Using ship-it to open a draft PR and get it through CI."

## Process

### 1. Prepare

Stage and commit any outstanding work:

1. Run `git status` and `git diff` to see what needs to be committed
2. If there are unstaged or uncommitted changes:
   - Stage the changes
   - Run `git log --oneline -10` to match the repo's commit message style
   - Commit with a clear message
3. If everything is already committed, skip to push
4. Push to remote — use `git push -u origin HEAD` to set upstream if needed

If the branch has no commits ahead of main, stop and tell the user there's nothing to ship.

### 2. Open Draft PR

1. Check for a PR template in the repo. Look in these locations (first match wins):
   - `.github/pull_request_template.md`
   - `.github/PULL_REQUEST_TEMPLATE.md`
   - `docs/pull_request_template.md`
   - `.github/PULL_REQUEST_TEMPLATE/` directory (if multiple templates exist, use the default)
2. Auto-generate the PR title from the branch name and commit history — keep it under 70 characters
3. Auto-generate the PR description:
   - If a repo template was found, fill it in based on the changes
   - If no template, use this format:
     ```
     ## Summary
     <bullet points describing what changed and why>

     ## Test plan
     <how to verify the changes>
     ```
4. Create the draft PR:
   ```
   gh pr create --draft --title "<title>" --base main --body "<description>"
   ```
5. Print the draft PR URL for the user

### 3. Poll-Fix Loop

Monitor CI checks and fix any failures:

1. **Poll** — Run `gh pr checks` to get the status of all checks
   - If any checks are still pending/in-progress, wait 30 seconds and poll again
   - If all checks passed, go to Step 4
   - If any checks failed, proceed to diagnose

2. **Diagnose** — For each failed check:
   - Use `gh run view <run-id> --log-failed` to read the failure logs
   - Identify the root cause of each failure

3. **Fix** — Batch all fixes together:
   - Fix all identified issues
   - Run any relevant local checks (tests, linting, type checking) to verify fixes before pushing
   - Stage, commit, and push the fixes in a single commit
   - Message format: "Fix CI: <brief description of what was fixed>"

4. **Re-poll** — Return to step 1 and wait for the new checks to run

There is no iteration cap. Keep going until all checks pass.

### 4. Mark Ready and Report

Once all checks pass:

1. Mark the PR as ready for review:
   ```
   gh pr ready
   ```

2. Print a summary to the user:
   - PR title and URL
   - What the PR contains (brief summary of changes)
   - If any CI fixes were needed: which checks failed and what was fixed
   - If no fixes were needed: note that all checks passed on the first try
