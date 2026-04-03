---
name: validate-it
description: >
  Quality gate between implementation and opening a PR. Runs code review and
  verifies acceptance criteria against the plan. Use when implementation is
  complete and you want to validate before shipping. Triggered by "validate it",
  "validate this", "run validation", or /validate-it.
---

# Validate It

Validate completed implementation before opening a PR: code review + AC traceability.

**Announce at start:** "Using validate-it to review code quality and verify acceptance criteria."

## Process

### 1. Load Context

Load the plan and identify changed files:

1. Read the plan file — locate the **Verification** section and each task's **Done when** conditions
2. Run `git diff --name-only origin/main...HEAD` to get the list of changed files
3. If no plan file is found and neither Verification nor Done when conditions exist, stop and tell the user:
   > "No AC found — run `/plan-it` first or describe what done looks like."

### 2. Code Review

Dispatch a fresh `superpowers:code-reviewer` subagent with:
- The list of changed files from Step 1
- The plan context (what was intended)
- Instructions to check:
  - Bugs and logic errors
  - Convention violations and code smells
  - Security issues
  - Test coverage gaps
  - Adherence to plan intent

Collect the reviewer's findings.

### 3. AC Verification

Use the acceptance criteria loaded in Step 1. Priority order:
1. Plan **Verification** section (preferred — most explicit)
2. Task **Done when** conditions
3. If neither exists: stop with the message from Step 1

For each criterion:
- Identify the specific code, file, or output that addresses it
- Run relevant commands to confirm (tests, type checks, file existence checks, etc.)
- Mark each criterion: **PASS**, **FAIL**, or **PARTIAL**

### 4. Report

Produce a structured validation report:

---

## Validation Report

### Code Review

<findings from Step 2 — bugs, smells, coverage gaps, security issues>

If no issues found: "No issues found."

### AC Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| <criterion 1> | PASS / FAIL / PARTIAL | <what was checked> |
| <criterion 2> | PASS / FAIL / PARTIAL | <what was checked> |

### Verdict

**NEEDS WORK** — if any code review issues or FAIL/PARTIAL AC items exist. List what must be addressed. Stop here — do not auto-fix.

**READY TO SHIP** — if all checks pass and all AC is verified. Tell the user:
> "Validation passed. Run `/ship-it` when you're ready to open a PR."
