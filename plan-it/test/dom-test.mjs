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

/* Controls must say what they act on. */
const toggle = doc.querySelector('.toggle:not(.theme)');
truthy('detail toggle names what it expands', /task details/i.test(toggle?.textContent ?? ''),
  `toggle label was ${JSON.stringify(toggle?.textContent)}`);
truthy('theme control is present', !!doc.querySelector('.toggle.theme'), 'no theme toggle');

/* Sub-bullet labels are marked up so a task body scans as fields. */
truthy('task detail labels are marked up', doc.querySelectorAll('.task-body .k').length > 0,
  'no .k labels found in any task body');
truthy('a known label was picked up',
  [...doc.querySelectorAll('.task-body .k')].some((k) => k.textContent === 'Files:'),
  'no "Files:" label was marked up');

/* Nothing in a task body may be dropped. Every sub-bullet label in the source has
   to appear somewhere in the rendered page. */
const labels = ['Files:', 'Test first:', 'Implement:', 'Verify:', 'Boundaries:', 'Signatures:'];
const bodyText = doc.getElementById('plan').textContent;
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
