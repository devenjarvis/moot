# moot

A pair of [Claude Code](https://docs.anthropic.com/en/docs/claude-code) custom skills for planning and executing implementation work. Moot separates the thinking from the doing — plan first, then execute with confidence.

## Skills

### `/plan`

Turns a user request into a structured implementation plan, scaled to the complexity of the work.

**Trigger phrases:** "plan this", "how should we build", "let's think through", or `/plan`

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

### `/execute`

Takes an implementation plan and runs it — dispatching parallel subagents for independent tasks, following TDD, and running code review before shipping.

**Trigger phrases:** "execute", "build this", "implement the plan", or `/execute`

The execute skill handles:
- **Plan validation** — checks that file paths and dependencies are still valid
- **Stacked PR detection** — proposes stacked PRs when tasks span independent concerns
- **TDD execution** — tests first, then implementation, for each task
- **Parallel dispatch** — independent tasks run as subagents using a structured implementer prompt
- **Automated code review** — dispatches a reviewer subagent before shipping
- **Escalation** — stops and asks when requirements are ambiguous or scope grows unexpectedly

## Installation

Clone the repo and add the skill directories to your Claude Code configuration:

```bash
git clone https://github.com/devenjarvis/moot.git
```

Then register the skills in your Claude Code project or user settings. See the [Claude Code custom skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills) for details on configuring custom skill directories.

## Project Structure

```
moot/
  plan/
    SKILL.md          # Plan skill definition
  execute/
    SKILL.md          # Execute skill definition
    implementer-prompt.md  # Template for subagent dispatch
```

## License

MIT
