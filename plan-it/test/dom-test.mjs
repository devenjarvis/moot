/* Behavioral assertions for the plan-aware layer, run in a real DOM.
 *
 * This exists because the transform once shipped completely inert -- it matched
 * only the tight-list shape marked emits, while the plan format produces loose
 * lists -- and a suite of string-presence checks stayed green through it. Grepping
 * the generated file for identifiers cannot catch that class of bug. Executing the
 * page can.
 *
 * jsdom is NOT a dependency of this repo; render-test.sh skips these checks when
 * it is unavailable. To run them:
 *
 *     npm install jsdom            # anywhere outside the repo
 *     JSDOM_PATH=/abs/path/to/node_modules/jsdom/lib/api.js \
 *       sh plan-it/test/render-test.sh
 *
 * Usage: node dom-test.mjs <rendered.html> <source-plan.md> [draft-rendered.html]
 *
 * The third argument is optional: pass a --draft render of the same plan to also
 * check the unapproved-draft banner. Without it those checks are skipped rather
 * than silently passing.
 */

import fs from 'node:fs';
import { TextDecoder } from 'node:util';

const [file, planPath, draftFile] = process.argv.slice(2);

const { JSDOM, VirtualConsole } = await import(process.env.JSDOM_PATH || 'jsdom');

let fails = 0;
let checks = 0;

function ok(label) {
  checks++;
  console.log(`  ok    ${label}`);
}
function no(label, detail) {
  checks++;
  fails++;
  console.log(`  FAIL  ${label}`);
  if (detail) console.log(`          ${detail}`);
}
function eq(label, want, got) {
  if (String(want) === String(got)) ok(label);
  else no(label, `expected ${want}, got ${got}`);
}
function truthy(label, cond, detail) {
  if (cond) ok(label);
  else no(label, detail);
}

/* injectTextDecoder=false exercises the percent-decode fallback, since jsdom's
   window has no TextDecoder of its own. */
async function renderFile(path, injectTextDecoder) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const opts = { runScripts: 'dangerously', virtualConsole: vc };
  if (injectTextDecoder) opts.beforeParse = (w) => { w.TextDecoder = TextDecoder; };
  const dom = new JSDOM(fs.readFileSync(path, 'utf8'), opts);
  await new Promise((r) => dom.window.addEventListener('load', r));
  return { doc: dom.window.document, errors };
}

const render = (injectTextDecoder) => renderFile(file, injectTextDecoder);

const plan = fs.readFileSync(planPath, 'utf8');
const wantTotal = (plan.match(/^- \[[ x]\] /gm) || []).length;
const wantDone = (plan.match(/^- \[x\] /gm) || []).length;

const { doc, errors } = await render(true);
const q = (s) => doc.querySelectorAll(s).length;
const bodyText = doc.getElementById('plan').textContent;

truthy('page renders with no scripting errors', errors.length === 0, errors[0]);

/* The transform ran at all. This is the assertion whose absence let a total
   feature failure ship green. */
truthy('task cards were built', q('.task') > 0, 'no .task elements -- the transform is inert');
eq('card count matches the plan', wantTotal, q('.task'));
eq('done count matches the plan', wantDone, q('.task.done'));
eq('no raw checkbox survives in the plan body', 0, q('#plan input[type=checkbox]'));

/* Constraint: the human-facing name is visible, the agent-facing detail is not. */
truthy(
  'every disclosure starts collapsed',
  [...doc.querySelectorAll('details.task')].every((d) => !d.open),
  'a task was open on load'
);
truthy(
  'every card exposes a non-empty name',
  [...doc.querySelectorAll('.task')].every((c) => c.querySelector('.task-name')?.textContent.trim()),
  'a card has an empty .task-name'
);
truthy(
  'names carry no stray leading or trailing space',
  [...doc.querySelectorAll('.task-name')].every((n) => n.textContent === n.textContent.trim()),
  'a .task-name has untrimmed whitespace'
);

/* Task count, and that it agrees with the source rather than the DOM.
 *
 * The bar is deliberately conditional: a 0% bar at review time is noise, and the
 * page is not re-rendered as work lands, so a full bar would mostly mean "this
 * was rendered after the fact". Assert the readout for whichever state applies. */
const noun = wantTotal === 1 ? 'task' : 'tasks';
const wantCount =
  wantDone === 0 ? `${wantTotal} ${noun}`
  : wantDone < wantTotal ? `${wantDone} of ${wantTotal} done`
  : `${wantTotal} ${noun} · all done`;
eq('task count readout matches the plan', wantCount, doc.querySelector('.count')?.textContent);

const bar = doc.querySelector('[role=progressbar]');
if (wantDone > 0 && wantDone < wantTotal) {
  truthy('progress bar is drawn while part-done', !!bar, 'no [role=progressbar]');
  eq('aria-valuenow matches', wantDone, bar?.getAttribute('aria-valuenow'));
  eq('aria-valuemax matches', wantTotal, bar?.getAttribute('aria-valuemax'));
} else {
  truthy('no progress bar outside the part-done state', !bar,
    `a bar was drawn at ${wantDone}/${wantTotal}`);
}

/* Controls must say what they act on, sit with what they act on, and expose
   their state. */
const toggle = doc.querySelector('.detail-toggle');
truthy('detail toggle names what it expands', /task details/i.test(toggle?.textContent ?? ''),
  `toggle label was ${JSON.stringify(toggle?.textContent)}`);
eq('detail toggle reports collapsed state', 'false', toggle?.getAttribute('aria-expanded'));
truthy('detail toggle sits in the plan, not the index',
  !!doc.querySelector('#plan .detail-toggle') && !doc.querySelector('#toc .detail-toggle'),
  'the toggle is still in the section index');
truthy('detail toggle shares a line with the heading of the section it acts on',
  !!toggle?.closest('.section-head')?.querySelector('h1, h2') ||
  !!toggle?.closest('.tasks-bar'),
  'the toggle is not attached to the tasks heading or a tasks bar');
truthy('an inlined heading keeps its id for the index',
  [...doc.querySelectorAll('.section-head h1, .section-head h2')].every((h) => !!h.id),
  'an inlined heading lost its id, breaking its index link');

const segButtons = [...doc.querySelectorAll('.seg button')];
eq('theme control offers three options', 3, segButtons.length);
eq('theme options are labelled', 'Auto,Light,Dark', segButtons.map((b) => b.textContent).join(','));
eq('exactly one theme option is selected', 1,
  segButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').length);
eq('the selected theme defaults to Auto', 'Auto',
  segButtons.find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent);

/* These documents load at an opaque origin, where jsdom throws on localStorage --
   the same condition some browsers impose on file:// URLs. So this doubles as the
   check that a blocked store degrades to "theme still switches, just doesn't
   persist" rather than taking the page down. */
const dark = segButtons.find((b) => b.textContent === 'Dark');
dark.click();
eq('choosing a theme applies it even when the store is blocked', 'dark',
  doc.documentElement.getAttribute('data-theme'));
eq('choosing a theme updates the pressed option', 'true', dark.getAttribute('aria-pressed'));
segButtons.find((b) => b.textContent === 'Auto').click();
truthy('returning to Auto hands control back to the OS',
  !doc.documentElement.hasAttribute('data-theme'), 'data-theme was left set');

/* Prose is serif, interface chrome is sans -- both from system stacks, since a
   web font would need the network the page must not touch. */
const css = fs.readFileSync(file, 'utf8');
truthy('prose uses a serif stack', /--serif:[^;]*\bui-serif\b/.test(css), 'no ui-serif in --serif');
truthy('body is set in the serif stack', /font:\s*[^;]*var\(--serif\)/.test(css), 'body does not use --serif');
/* Name the selectors rather than matching "--sans" anywhere: :root defines that
   token, so the loose version passed no matter which elements opted in. */
const sansRule = css.match(/([^\n{]*)\{\s*font-family: var\(--sans\);\s*\}/);
truthy('the chrome selectors opt into the sans stack',
  !!sansRule && ['#toc', '.detail-toggle', '.seg', '.fields dt'].every((s) => sansRule[1].includes(s)),
  `sans rule covers ${JSON.stringify(sansRule?.[1]?.trim())}`);
eq('no web font is fetched', 0, (css.match(/@font-face|fonts\.googleapis|fonts\.gstatic/g) || []).length);

/* Task bodies are recast as field tables: Label: value pairs become dt/dd on a
   two-column grid so the eye can run down the labels. */
truthy('task bodies become field tables', doc.querySelectorAll('.task-body dl.fields').length > 0,
  'no dl.fields found in any task body');
truthy('a known label was picked up',
  [...doc.querySelectorAll('.fields dt')].some((k) => k.textContent === 'Files:'),
  'no "Files:" label was marked up');
eq('every label has a value beside it',
  doc.querySelectorAll('.fields dt').length,
  doc.querySelectorAll('.fields dd:not(.span)').length);

/* A bullet that is not a Label: value pair must survive as a full-width row
   rather than being forced into the value column or dropped. */
truthy('unlabelled bullets become full-width rows',
  doc.querySelectorAll('.fields dd.span').length > 0, 'no dd.span rows found');
truthy('an unlabelled bullet keeps its text',
  bodyText.includes('A bare bullet with no label'), 'the unlabelled bullet text is gone');

/* A body with no labels at all must be left exactly as it was. Converting it and
   only then deciding not to keep the result silently emptied such bodies. */
truthy('a body with no labels is left as a plain list',
  bodyText.includes('just a bullet, which must survive verbatim') &&
  bodyText.includes('and another, which must also survive'),
  'an all-unlabelled task body lost its content');

/* Nothing in a task body may be dropped. Every sub-bullet label in the source has
   to appear somewhere in the rendered page. */
const labels = ['Files:', 'Test first:', 'Implement:', 'Verify:', 'Boundaries:', 'Signatures:'];
const missing = labels.filter((l) => plan.includes(l) && !bodyText.includes(l));
truthy('no task-body content was dropped', missing.length === 0, `missing: ${missing.join(', ')}`);

/* The mixed-list write path: a task list that also holds plain bullets is
   rewritten in place. It had no coverage at all, and a mutation that deleted every
   such card left the suite green. */
truthy('tasks in a mixed list are rewritten in place',
  doc.querySelectorAll('li.task-item .task').length > 0, 'no in-place task cards found');
truthy('a task in a mixed list keeps its name',
  bodyText.includes('MIXED-SENTINEL-TASK') && bodyText.includes('MIXED-SENTINEL-DONE'),
  'a mixed-list task lost its name');
truthy('plain bullets around a mixed-list task keep their order', (() => {
  const list = [...doc.querySelectorAll('#plan ul')].find((u) => u.querySelector('li.task-item'));
  const text = [...(list?.children ?? [])].map((li) => li.textContent.trim().slice(0, 24));
  return text[0]?.startsWith('A plain bullet leading') &&
    text.at(-1)?.startsWith('A plain bullet closing');
})(), 'the mixed list was reordered');

/* Section index and location chips. */
truthy('section index has links', q('#toc a') > 0, 'no nav links');
truthy('index entries point at real targets',
  [...doc.querySelectorAll('#toc a')].every((a) => doc.getElementById(a.hash.slice(1))),
  'an index link points at no element');
truthy('no index entry targets something inside a collapsed task',
  [...doc.querySelectorAll('#toc a')].every((a) =>
    !doc.getElementById(a.hash.slice(1))?.parentNode.closest('.task-body')),
  'an index link targets a heading buried in a task body');

/* Chips: assert they are produced, not merely absent from the wrong places. A
   deleted chipLocations() call used to leave every chip assertion green. */
truthy('location chips are produced', q('code.loc') > 0, 'no .loc chips at all');
truthy('a known file:line became a chip',
  [...doc.querySelectorAll('code.loc')].some((c) => c.textContent === 'path/to/file.ts:42'),
  'path/to/file.ts:42 was not chipped');
eq('no chip was injected inside a code sample', 0, q('code code.loc, pre code.loc'));
eq('no chip was injected inside a link', 0, q('a code.loc'));

/* Raw HTML in a plan must be inert. The fixture carries unbackticked img, iframe,
   style, script and div tags, so these assertions have something to catch -- with
   a fixture free of raw HTML they were vacuous. */
truthy('the fixture actually contains raw HTML to escape', /<img src=|<iframe|<script>window/.test(plan),
  'the fixture has no raw HTML, so the inertness checks below prove nothing');
eq('no image element was injected', 0, q('#plan img'));
eq('no script element was injected', 0, q('#plan script'));
eq('no style element was injected', 0, q('#plan style'));
eq('no iframe was injected', 0, q('#plan iframe'));
eq('no positioned block element was injected', 0, q('#plan div[style]'));
truthy('an inline script in the plan did not execute',
  doc.defaultView.FIXTURE_PWNED === undefined, 'the plan executed script');
truthy('the raw markup is shown as text instead',
  bodyText.includes('<img src=') && bodyText.includes('<script>window.FIXTURE_PWNED'),
  'the raw markup was neither rendered nor displayed');

/* Collapsed reference sections.
 *
 * Context, Reuse and Risks are background for the building agent; folding them
 * keeps the goal, the criteria and the task names in one screen. Everything the
 * reader reviews for correctness has to stay open. */
const sectionOf = (name) =>
  [...doc.querySelectorAll('#plan details.section > summary > h2')]
    .find((h) => h.textContent.trim().toLowerCase() === name)?.closest('details.section');

truthy('reference sections were folded', q('#plan details.section') > 0,
  'no details.section elements -- the transform is inert');
for (const name of ['context', 'reuse', 'risks']) {
  const sec = sectionOf(name);
  truthy(`${name} is folded`, !!sec, `no details.section for ${name}`);
  truthy(`${name} starts closed`, sec && !sec.open, `${name} was open on load`);
}

/* The heading must be the summary, not buried in the body. Inside a closed
   disclosure it would give the index an entry that appears to do nothing -- the
   exact failure the `headings` filter was written to prevent. */
truthy('a folded section keeps its heading visible as the summary',
  [...doc.querySelectorAll('#plan details.section')].every((s) => s.querySelector(':scope > summary > h2')),
  'a folded section has no h2 in its summary');
truthy('a folded section heading keeps its id for the index',
  [...doc.querySelectorAll('#plan details.section > summary > h2')].every((h) => !!h.id),
  'a folded heading has no id, so its index link is dead');
truthy('every folded section has an index entry pointing at it',
  ['context', 'reuse', 'risks'].every((name) => {
    const h = sectionOf(name)?.querySelector(':scope > summary > h2');
    return h && [...doc.querySelectorAll('#toc a')].some((a) => a.hash === `#${h.id}`);
  }),
  'a folded section is missing from the section index');

/* Only the reference sections fold. Goal, Spec, Tasks and the rest are what the
   reader is reviewing, so they must not be hidden behind a click. */
const foldedNames = [...doc.querySelectorAll('#plan details.section > summary > h2')]
  .map((h) => h.textContent.trim().toLowerCase());
eq('nothing outside the reference sections was folded', '',
  foldedNames.filter((n) => !['context', 'reuse', 'risks'].includes(n)).join(','));
truthy('the tasks section is not folded',
  !foldedNames.includes('tasks') && q('#plan .task') > 0,
  'the Tasks section was folded');

/* Content must survive the move. A transform that wrapped the heading but dropped
   the body would leave a page that looks right and says nothing. */
truthy('a folded section keeps its body',
  ['context', 'reuse', 'risks'].every((name) =>
    (sectionOf(name)?.querySelector('.section-body')?.textContent.trim().length ?? 0) > 0),
  'a folded section has an empty body');
truthy('folded sections report how much they hide',
  [...doc.querySelectorAll('#plan details.section')].every((s) =>
    /\d+ items?/.test(s.querySelector('.section-count')?.textContent ?? '')),
  'a folded section has no item count in its summary');

/* Print must reveal them: a printout is read away from the disclosure controls, and
   a page that printed without Context gives the reader no hint anything is missing.
 *
 * Driven by dispatching the real events rather than grepping the handler's
 * selector. A source-text check here passed whether or not the handler had been
 * widened, since the .section CSS above it satisfied the pattern on its own. */
{
  const win = doc.defaultView;
  const all = () => [...doc.querySelectorAll('#plan details.task, #plan details.section')];
  const closedBefore = all().filter((d) => !d.open).length;
  truthy('there is something folded to reveal', closedBefore > 0, 'nothing was closed to begin with');

  win.dispatchEvent(new win.Event('beforeprint'));
  eq('printing opens every folded disclosure', 0, all().filter((d) => !d.open).length);
  truthy('printing opens the reference sections specifically',
    [...doc.querySelectorAll('#plan details.section')].every((s) => s.open),
    'a reference section stayed closed for the print');

  win.dispatchEvent(new win.Event('afterprint'));
  eq('the reader gets their fold state back afterwards',
    closedBefore, all().filter((d) => !d.open).length);
}

/* The unapproved-draft banner.
 *
 * plan-it opens the preview before the approval gate, so a page the reader has not
 * signed off on has to say so -- otherwise the preview and the approved plan are
 * indistinguishable, and a plan.html newer than plan.md reads as authoritative. */
truthy('a default render carries no draft banner', !doc.querySelector('.draft'),
  'a .draft element appeared without --draft');

if (draftFile) {
  const { doc: draftDoc, errors: draftErrors } = await renderFile(draftFile, true);
  truthy('draft render has no scripting errors', draftErrors.length === 0, draftErrors[0]);

  const banner = draftDoc.querySelector('.draft');
  truthy('a --draft render carries a draft banner', !!banner, 'no .draft element');
  truthy('the banner says the plan is not approved yet',
    /draft/i.test(banner?.textContent ?? '') && /approve?d/i.test(banner?.textContent ?? ''),
    `banner text was ${JSON.stringify(banner?.textContent)}`);

  /* Outside #plan, so it cannot be mistaken for plan content and is not swept up
     by any transform that walks the plan body. */
  truthy('the banner sits outside the plan body', !!banner && !banner.closest('#plan'),
    'the banner was placed inside #plan');
  truthy('the banner precedes the plan',
    !!banner && !!draftDoc.querySelector('.layout') &&
    (banner.compareDocumentPosition(draftDoc.querySelector('.layout')) &
      draftDoc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    'the banner does not come before .layout');

  /* The flag must change nothing else. A draft that renders a different plan than
     the approved one would make the review worthless. */
  eq('the draft render produces the same card count',
    q('.task'), draftDoc.querySelectorAll('.task').length);
  eq('the draft render produces the same plan text',
    doc.getElementById('plan').textContent.length,
    draftDoc.getElementById('plan').textContent.length);

  /* A printed draft must still say draft: a plan read on paper is exactly where
     "is this approved?" is least recoverable. */
  truthy('the banner is not hidden in print',
    !/@media print[\s\S]*?\.draft[^{]*\{[^}]*display:\s*none/.test(css),
    'a print rule hides the draft banner');
} else {
  console.log('  skip  draft banner checks (no draft render passed as argv[3])');
}

/* The decode fallback must produce the same document as TextDecoder. */
const fallback = await render(false);
truthy('fallback decode path renders without error', fallback.errors.length === 0, fallback.errors[0]);
eq('fallback decode produces the same card count', q('.task'), fallback.doc.querySelectorAll('.task').length);
eq('fallback decode produces identical text',
  doc.getElementById('plan').textContent.length,
  fallback.doc.getElementById('plan').textContent.length);

console.log(`\n  ${checks - fails} of ${checks} DOM checks passed`);
process.exit(fails === 0 ? 0 : 1);
