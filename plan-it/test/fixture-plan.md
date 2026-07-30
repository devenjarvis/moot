# Goal

FIXTURE-SENTINEL-GOAL — exercise every markdown construct the plan renderer must survive, so regressions surface without a browser.

## Spec

1. Headings at three depths render as a navigable hierarchy.
2. A numbered spec list keeps its numbering.
3. A table renders with a real header row.
4. A fenced code block containing a closing script tag does not truncate the page.
5. Non-ASCII punctuation reaches the page unmangled.

## Context

- Entry point lives at `path/to/file.ts:42` and the caller is at path/to/other.ts:88 — one backticked, one bare, so the location-chip walker is exercised both ways.
- This bullet contains an em-dash — an arrow → and a **bold run**, plus a [link to the plan format](https://example.invalid/plan-format) whose href must not count as a network-loading reference.
- An unbackticked generic, FIXTURE-SENTINEL-GENERIC Map<string, Foo>, must reach the page intact rather than being swallowed as a tag.

### A third-level heading

Prose under a `###` heading, with `inline code` in it.

| Tier | Explore | Gate |
|------|---------|------|
| Trivial | Glance | No |
| Moderate | Targeted | No |
| Complex | Deep — parallel | Yes |

A fenced block whose body contains a literal closing script tag:

```html
<script id="plan-src" type="text/markdown">
FIXTURE-SENTINEL-FENCE
</script>
<p>text after the closing tag must still render</p>
```

### Raw markup that must stay inert

Unbackticked HTML, so the escaping is actually exercised rather than assumed. None
of this may become a live element, load anything, or run:

- An image: <img src="https://example.invalid/pixel.png" alt="must not load">
- A frame: <iframe src="https://example.invalid/frame"></iframe>
- A style block: <style>body { background: #f00 }</style>
- A script: <script>window.FIXTURE_PWNED = 1</script>
- A bare block element: <div style="position:fixed;inset:0">must not cover the page</div>

## Reuse

- Nothing to reuse — this is a fixture, and the absence is the point.

## Risks

- If the escape round-trip breaks, everything below the fenced block disappears.
- A backslash-escaped closing tag, `<\/script>`, must survive as those exact bytes. A textual escape scheme rewrites `</script` to `<\/script` and cannot tell the two apart on the way back, so it silently corrupts this line — which is why the plan rides encoded instead.

## Tasks

- [x] Land the first checked task
  - Files: path/to/file.ts:42
  - Signatures: `renderPlan(md: string): string`
  - Test first: assert the checked state is detected, expecting a count of 3.
  - Implement: nothing — fixture content only.
  - Verify: `sh plan-it/test/render-test.sh` exits 0.
  - Boundaries: does not touch the second task.

- [x] Land the second checked task with a generic in its signature
  - Files: path/to/other.ts:88
  - Signatures: buildIndex(headings: Map<string, Foo>): void
  - Test first: assert the bare generic survives.
  - Implement: nothing — fixture content only.
  - Verify: manual — read the rendered page.
  - Boundaries: does not touch the stylesheet.

- [x] Land the third checked task
  - Files: path/to/third.ts:7
  - Test first: none — this task deliberately omits the Signatures bullet.
  - Implement: nothing — fixture content only.
  - Verify: `sh plan-it/test/render-test.sh` exits 0.
  - Boundaries: does not add sub-bullets beyond these.

- [ ] Leave the fourth task unchecked
  - Files: path/to/fourth.ts:100
  - Test first: assert the unchecked count is 2.
  - Implement: nothing — fixture content only.
  - Verify: progress readout shows 4 of 8 done.
  - Boundaries: stays unchecked.

- [ ] Leave the fifth task unchecked
  - Files: path/to/fifth.ts:1
  - Test first: assert nested sub-bullets collapse by default.
  - Implement: nothing — fixture content only.
  - Verify: manual — the sub-bullets are hidden until the disclosure is opened.
  - Boundaries: stays unchecked.

- [x] Carry no sub-bullets at all, to exercise the bare-task shape

- [ ] Mix labelled and unlabelled sub-bullets
  - Files: path/to/mixed.ts:5
  - A bare bullet with no label, which must become a full-width row
  - Verify: `sh plan-it/test/render-test.sh` exits 0.

- [ ] Carry a body with no labels whatsoever
  - just a bullet, which must survive verbatim
  - and another, which must also survive

## Follow-up tasks

A second task list that also holds plain bullets, so the in-place rewrite path is
covered. No `.tasks` group is produced for this list at all, which is what made the
whole nav layer throw when the anchor lookup assumed one existed.

- A plain bullet leading the list
- [ ] MIXED-SENTINEL-TASK a task inside a mixed list
  - Files: path/to/inplace.ts:9
  - Verify: the card renders in place, keeping document order.
- A plain bullet between tasks
- [x] MIXED-SENTINEL-DONE a checked task inside a mixed list
- A plain bullet closing the list

## Parallelism

- Tasks 1 and 2 are independent — can run as parallel subagents.
- Task 3 depends on task 1 completing first.

## PR Boundaries

Ship as one PR — it is a fixture.

## Verification

1. `sh plan-it/test/render-test.sh` — exits 0.
2. Open the rendered fixture and confirm the fenced block displays verbatim.

## Not In Scope

- Any real behavior. This file exists only to be rendered.
