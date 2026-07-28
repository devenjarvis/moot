---
name: spec-it
description: Use when a product manager or non-engineer needs to define a unit of work for engineering. Guides a conversation to produce a Capability Card — a structured spec that product can validate and engineering can plan from. Triggered by "write a ticket", "create a spec", "define the requirements", "help me write this up", or /spec-it.
---

# Capability Card

Turn a product intent into a structured spec that product can validate and engineering can plan from.

## What a Capability Card Is

The atomic unit of work in an LLM-first PDLC. It replaces the traditional Jira ticket — not by adding fields, but by making the right content explicit and nothing else:

| Section | Owner | Purpose |
|---------|-------|---------|
| Problem statement | Product | "Is this the right problem?" |
| Acceptance criteria | Product | "Will I recognize done when I see it?" |
| Constraints | Product | "What must NOT change?" |
| Out of scope | Product | "What are we explicitly not doing?" |

Product can validate all four. Engineering and LLMs fill in the technical approach below this line — but only after this artifact is signed off.

**The boundary rule:** if product says "I can't tell you if that's right," something technical has leaked into the card. Find it and remove it. This rule governs everything below — the questions you ask, the criteria you write, and the card you produce.

### 1. Listen

Read what the user gave you in their own words. Identify what's missing: who has the problem, what the testable outcome is, what could be misread as a technical decision, and whether the boundaries are explicit or assumed.

### 2. Ask

Use `AskUserQuestion` for what you can't infer, in product language. Four topics drive a Capability Card:

- **Problem framing** — who experiences this, and the impact when it isn't solved
- **Done signal** — what they'll be able to do, or stop doing, that they can't today
- **Constraints** — what must stay exactly as it is
- **Scope boundary** — what related things they are explicitly not solving

Adapt them to what you actually need; skip any the user's first message already answered.

### 3. Surface Edge Cases

Do this before writing, always. Find where things go wrong at the product level — missing or unusual input, common user mistakes, the boundary of what this capability covers, the expected outcome failing to materialize. Ask the 1–3 failure modes most worth surfacing in a single round, framed as "what should happen when X." If the user's description seems complete, that's a signal to look harder, not to skip the round. Fold their answers into the acceptance criteria as observable outcomes.

### 4. Write the Card

Produce a clean artifact, not a conversation summary:

```markdown
## [Short title — one line, active voice]

### Problem Statement
[Who is affected, what is broken or missing, and what the impact is.
Written in business language. No implementation language.]

### Acceptance Criteria
[A bulleted list of observable, product-validatable outcomes.
Each criterion should be something a non-engineer can verify.
Written as: "Given [condition], [observable outcome]."
If you can't verify it without reading code, rewrite it.]

### Constraints
[What must NOT change.
What a "successful" implementation must not break.
Written as explicit statements, not vague hedges.]

### Out of Scope
[What is explicitly excluded.
Things that might seem related but are not part of this card.
State them clearly so engineering doesn't build them and product doesn't expect them.]
```

Out-of-scope entries should be specific ("not redesigning the nav," not "no unrelated changes").

### 5. Validate

Before showing the card, check it silently and fix what fails: an engineer could start building without calling the PM, a PM could verify done without asking an engineer, and the card is under ~300 words — length past that means something technical leaked in.

Then ask: "Does this capture what you meant? Is anything missing or wrong?" Iterate until product says yes.

### 6. Handoff

> "Capability Card ready. Hand this to engineering with: 'Feed this into plan-it to get a technical implementation plan.'"

The card's acceptance criteria become the `Spec` section of the technical plan. Both sides use the same source of truth.
