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

## Instructions
1. Write or update tests first for the behavior you're implementing
2. Run tests — confirm they fail for the right reason
3. Implement the task to make tests pass
4. Run tests — confirm they pass
5. Commit with a clear message describing what you did and why
6. Report your status

## Status
Report one of:
- **DONE** — task complete, tests pass, committed
- **BLOCKED** — cannot proceed because [specific reason]
- **NEEDS_CONTEXT** — need clarification on [specific question]

## Guidelines
- Follow existing patterns in the codebase. Read neighboring code before writing.
- If something is ambiguous, report NEEDS_CONTEXT rather than guessing.
- Don't refactor code outside your task's file list.
- Don't add features beyond what the task describes.
- Keep changes minimal and focused.
```
