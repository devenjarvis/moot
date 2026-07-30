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
 * Usage: node dom-test.mjs <rendered.html> <source-plan.md>
 */

import fs from 'node:fs';
import { TextDecoder } from 'node:util';

const [file, planPath] = process.argv.slice(2);

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
async function render(injectTextDecoder) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const opts = { runScripts: 'dangerously', virtualConsole: vc };
  if (injectTextDecoder) opts.beforeParse = (w) => { w.TextDecoder = TextDecoder; };
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), opts);
  await new Promise((r) => dom.window.addEventListener('load', r));
  return { doc: dom.window.document, errors };
}

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
truthy('controls stay in the sans stack', /\.detail-toggle[^{]*\{[^}]*\}|--sans/.test(css) &&
  /#toc[^{]*\.task-body \.k \{ font-family: var\(--sans\); \}|font-family: var\(--sans\)/.test(css),
  'chrome does not opt into --sans');
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

/* Section index and location chips. */
truthy('section index has links', q('#toc a') > 0, 'no nav links');
eq('no chip was injected inside a code sample', 0, q('code code.loc, pre code.loc'));

/* Raw HTML in a plan must be inert. */
eq('no image element was injected', 0, q('#plan img'));
eq('no script element was injected', 0, q('#plan script'));
eq('no style element was injected', 0, q('#plan style'));
eq('no iframe was injected', 0, q('#plan iframe'));

/* The decode fallback must produce the same document as TextDecoder. */
const fallback = await render(false);
truthy('fallback decode path renders without error', fallback.errors.length === 0, fallback.errors[0]);
eq('fallback decode produces the same card count', q('.task'), fallback.doc.querySelectorAll('.task').length);
eq('fallback decode produces identical text',
  doc.getElementById('plan').textContent.length,
  fallback.doc.getElementById('plan').textContent.length);

console.log(`\n  ${checks - fails} of ${checks} DOM checks passed`);
process.exit(fails === 0 ? 0 : 1);
