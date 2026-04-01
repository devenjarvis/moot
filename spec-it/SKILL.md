---
name: spec-it
description: Use when a product manager or non-engineer needs to define a unit of work for engineering. Guides a conversation to produce a Capability Card — a structured spec that product can validate and engineering can plan from. Triggered by "write a ticket", "create a spec", "define the requirements", "help me write this up", or /spec-it.
---

# Capability Card

Turn a product intent into a structured spec that product can validate and engineering can plan from.

## What a Capability Card Is

A Capability Card is the atomic unit of work in an LLM-first PDLC. It replaces the traditional Jira ticket — not by adding more fields, but by making the right content explicit:

| Section | Owner | Purpose |
|---------|-------|---------|
| Problem statement | Product | "Is this the right problem?" |
| Acceptance criteria | Product | "Will I recognize done when I see it?" |
| Constraints | Product | "What must NOT change?" |
| Out of scope | Product | "What are we explicitly not doing?" |

Product can validate all four. Engineering and LLMs fill in the technical approach below this line — but only after this artifact is signed off.

**The boundary rule:** If product says "I can't tell you if that's right," something technical has leaked into the card. That's a boundary violation — remove it.

---

## Process

### 1. Listen

The user tells you what they want — often loosely, in their own words. That's fine. Your job is not to clean it up yet. Read it and identify what's missing:

- Is it clear who has the problem?
- Is there a testable outcome stated?
- Is there anything that could be misread as a technical decision?
- Are the boundaries explicit, or assumed?

### 2. Ask — Don't Assume

Use `AskUserQuestion` to surface the gaps. Ask only what you can't infer. Batch up to 4 questions per call. These are conversational, free-text questions — not structured choices. The user answers in their own words; that's the point.

**The four questions that drive a Capability Card:**

1. **Problem framing** — "Who experiences this problem, and what's the impact when it's not solved?"
2. **Done signal** — "How will you know this is done? What will you be able to do (or stop doing) that you can't (or have to) do today?"
3. **Constraints** — "What must stay exactly as it is? What would a successful outcome break that you'd consider unacceptable?"
4. **Scope boundary** — "What related things are you explicitly NOT trying to solve here?"

Adapt these to what you actually need. If the user's original message answers one, skip it.

**Rules for questions:**
- Ask in product language, not engineering language
- Do not ask about implementation, architecture, or technical approach — ever
- If you catch yourself asking "should we use X or Y technology", stop. That's engineering's question.
- "How will we build this?" is never your question. "How will you know it's built correctly?" is always your question.

### 3. Write the Card

Once you have enough to answer all four sections, produce the Capability Card. Write it as a clean artifact, not a conversation summary.

**Format:**

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

**Writing rules:**
- Acceptance criteria must be testable by product without engineering help
- If a criterion implies a technical decision, rewrite it to describe the observable outcome instead
- "Out of scope" entries should be specific, not generic ("not redesigning the nav" not "no unrelated changes")
- The card should be ~half a page when complete — if it's longer, something technical has leaked in

### 4. Validate

After writing the card, ask:

> "Does this capture what you meant? Is there anything that's missing or that I've gotten wrong?"

Then iterate until product says yes.

**Validation check (run silently before asking — fix any failures before proceeding):**
- Could an engineer start building from this without calling the PM? (Good)
- Could a PM verify that the build is done without asking an engineer? (Good)
- Does the card say *how* anything should be built? (Bad — remove it)
- Are any acceptance criteria only checkable by reading code or running technical tests? (Bad — rewrite them)
- Is the card longer than ~300 words? (Bad — something technical has leaked in, trim it)

If any check fails, revise the card to fix the issue before asking for product validation.

### 5. Handoff

Once product approves the card, tell them:

> "Capability Card ready. Hand this to engineering with: 'Feed this into plan-it to get a technical implementation plan.'"

The acceptance criteria in the card become the Verification section of the technical plan. Both sides use the same source of truth.

---

## What NOT to Do

**Don't generate technical answers.** If the user says "we need faster search," don't say "we could add an index" or "we could switch to Elasticsearch." Say "What does 'fast enough' look like to a user? How would they notice the difference?"

**Don't add implementation notes.** No "this will require changes to the API" or "the database schema will need updating." That's plan-it's job.

**Don't write acceptance criteria that require code to verify.** "The query returns results in under 200ms" is an engineering metric. "Users see results before they finish typing" is a product criterion.

**Don't ask engineering questions.** "Should we cache the results?" "What's the API contract?" "How many records are we paginating?" These are not your questions in this skill.

---

## Quick Reference

| You're hearing... | Your response |
|-------------------|---------------|
| "We need to build X" | Ask: who has the problem, how will they know it's solved |
| "It should work like..." | Ask: how will you recognize it's working correctly |
| "Make it faster/better/easier" | Ask: what does that look like to the user |
| "We need to support X use case" | Ask: what would the user do that they can't do today |
| "I can't tell you if that's right" | Something technical leaked — find it and remove it |
