# Implementer Subagent Prompt

Use this template when dispatching subagents for independent tasks.

## Template

```
## Task
{{task_description}}

## Context
{{context_from_plan — what this task is part of, why it matters}}

## Files
{{exact file paths to create or modify}}

## Constraints
{{patterns to follow, boundaries not to cross, edge cases to handle}}

## How to Work
Write the tests first and confirm they fail for the right reason, then implement until
they pass. Follow the patterns in neighboring code. Commit with a clear message.

## Status
End your report with one of:
- **DONE** — task complete, tests pass, committed
- **BLOCKED** — cannot proceed because [specific reason]
- **NEEDS_CONTEXT** — need clarification on [specific question]
```
