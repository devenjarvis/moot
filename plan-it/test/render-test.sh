#!/bin/sh
# Assertions for plan-it/render-plan.sh that need no browser.
#
# Covers Spec 1, 2, 5, 7, 8, 9 from the plan. The visual criteria (3, 4, 6) are
# not checkable here and are verified by hand against the rendered fixture --
# see the Verification section of the plan.
#
# Usage: sh plan-it/test/render-test.sh

DIR=$(cd "$(dirname "$0")" && pwd)
RENDER="$DIR/../render-plan.sh"
FIXTURE="$DIR/fixture-plan.md"

fails=0
checks=0

ok() {
	checks=$((checks + 1))
	printf '  ok    %s\n' "$1"
}

no() {
	checks=$((checks + 1))
	fails=$((fails + 1))
	printf '  FAIL  %s\n' "$1"
	[ -n "$2" ] && printf '          %s\n' "$2"
}

# assert_count <label> <expected> <actual>
assert_count() {
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		no "$1" "expected $2, got $3"
	fi
}

# count_str <fixed-string> <file>  -- occurrences, not lines
count_str() {
	grep -oF -- "$1" "$2" 2>/dev/null | wc -l | tr -d ' '
}

# assert_has <label> <fixed-string> <file>
assert_has() {
	if grep -qF -- "$2" "$3"; then
		ok "$1"
	else
		no "$1" "missing: $2"
	fi
}

# truthy_file <label> <path>
truthy_file() {
	if [ -s "$2" ]; then
		ok "$1"
	else
		no "$1" "missing or empty: $2"
	fi
}

# assert_exit <label> <expected-code> <command...>
# Defined up here with the other helpers on purpose: it was originally declared
# further down, and a call site above the definition failed with "command not
# found" while the suite still reported every check passing.
assert_exit() {
	label=$1
	want=$2
	shift 2
	"$@" >/dev/null 2>"$TMP/stderr-case"
	got=$?
	if [ "$got" -ne "$want" ]; then
		no "$label" "expected exit $want, got $got"
	elif [ ! -s "$TMP/stderr-case" ]; then
		no "$label" "exit $want but nothing on stderr"
	else
		ok "$label"
	fi
}

printf '\nrender-plan.sh\n'

# --- preconditions -----------------------------------------------------------

if [ ! -f "$RENDER" ]; then
	no "renderer exists at plan-it/render-plan.sh" "not found -- nothing else can run"
	printf '\n%s of %s checks passed\n\n' "$((checks - fails))" "$checks"
	exit 1
fi
ok "renderer exists at plan-it/render-plan.sh"

if [ -x "$RENDER" ]; then
	ok "renderer is executable"
else
	no "renderer is executable" "chmod +x plan-it/render-plan.sh"
fi

if [ -f "$FIXTURE" ]; then
	ok "fixture exists"
else
	no "fixture exists" "$FIXTURE not found"
	printf '\n%s of %s checks passed\n\n' "$((checks - fails))" "$checks"
	exit 1
fi

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT INT TERM
OUT="$TMP/plan.html"

# Point the renderer's scratch space at our own fresh directory. Without this the
# leak check below cannot tell this run's temp files from a stale one left by an
# earlier crash or a concurrent run, and the suite goes red for someone else's
# mess.
TMPDIR="$TMP"
export TMPDIR

# --- Spec 1: renders successfully -------------------------------------------

if "$RENDER" "$FIXTURE" "$OUT" >"$TMP/stdout" 2>"$TMP/stderr"; then
	ok "exits 0 on the fixture"
else
	no "exits 0 on the fixture" "exit $?; stderr: $(cat "$TMP/stderr")"
fi

if [ -s "$OUT" ]; then
	ok "writes a non-empty file"
else
	no "writes a non-empty file" "$OUT is missing or empty"
	printf '\n%s of %s checks passed\n\n' "$((checks - fails))" "$checks"
	exit 1
fi

if grep -qi '<!doctype html' "$OUT"; then
	ok "output is a full HTML document"
else
	no "output is a full HTML document" "no doctype"
fi

assert_count "exactly one </html>" 1 "$(count_str '</html>' "$OUT")"

# --- Spec 2: no external subresource ----------------------------------------
# Anchor hrefs are allowed on purpose: the fixture links out, and a link the
# reader may click is not something the page fetches when it opens. What must
# be absent is anything loaded automatically.

assert_count 'no src="http' 0 "$(count_str 'src="http' "$OUT")"
assert_count "no src='http" 0 "$(count_str "src='http" "$OUT")"
assert_count 'no protocol-relative src' 0 "$(count_str 'src="//' "$OUT")"
assert_count "no @import" 0 "$(count_str '@import' "$OUT")"
assert_count "no url(http" 0 "$(count_str 'url(http' "$OUT")"
assert_count "no <link element" 0 "$(count_str '<link' "$OUT")"
assert_count "no <iframe" 0 "$(count_str '<iframe' "$OUT")"
assert_count "no srcset" 0 "$(count_str 'srcset' "$OUT")"

# --- vendored parser is inlined ---------------------------------------------
# Match the banner without pinning a major version: a deliberate marked upgrade
# should be caught by MARKED-LICENSE.md's checksum, not by failing this label.

assert_has "marked payload is inlined" 'a markdown parser' "$OUT"

# --- Spec 7 and 8: the plan survives embedding, byte for byte -----------------
# The plan rides base64-encoded, so no byte of it -- including the closing script
# tag inside the fixture's fenced block -- can end the block early. That makes the
# strongest possible assertion available: decode the payload and compare it to the
# fixture exactly. This subsumes any per-string check for the closing tag, the
# unbackticked generic, and the non-ASCII punctuation.

decode() {
	if base64 -d </dev/null >/dev/null 2>&1; then
		base64 -d
	else
		base64 -D
	fi
}

sed -n '/id="plan-src"/,/^<\/script>$/p' "$OUT" | sed '1d;$d' >"$TMP/payload.b64"

if [ -s "$TMP/payload.b64" ]; then
	ok "plan-src block carries a payload"
else
	no "plan-src block carries a payload" "block was empty"
fi

if decode <"$TMP/payload.b64" >"$TMP/decoded.md" 2>"$TMP/decode-err"; then
	ok "payload decodes"
else
	no "payload decodes" "$(head -2 "$TMP/decode-err")"
fi

if cmp -s "$TMP/decoded.md" "$FIXTURE"; then
	ok "decoded plan is byte-for-byte identical to the source"
else
	no "decoded plan is byte-for-byte identical to the source" \
		"$(cmp "$TMP/decoded.md" "$FIXTURE" 2>&1 | head -2)"
fi

# Named checks on the decoded text as well: cmp proves everything, but a failure
# here says which construct broke instead of just reporting a byte offset.
assert_has "closing script tag survives the round trip" '</script>' "$TMP/decoded.md"
assert_has "unbackticked generic survives" 'Map<string, Foo>' "$TMP/decoded.md"
assert_has "em-dash survives" '—' "$TMP/decoded.md"
assert_has "arrow survives" '→' "$TMP/decoded.md"
assert_has "file:line reference survives" 'path/to/file.ts:42' "$TMP/decoded.md"
assert_count "fixture carries 5 checked tasks" 5 "$(count_str '- [x]' "$TMP/decoded.md")"
assert_count "fixture carries 5 unchecked tasks" 5 "$(count_str '- [ ]' "$TMP/decoded.md")"

# --- plan-aware layer is bundled ---------------------------------------------
# These are string checks, not behavior: they only prove the layer was
# concatenated in, so a template edit that drops it fails loudly. Labelled as
# "bundled" rather than "works" on purpose -- an earlier version of this file
# claimed things like "progress meter is present", which read as behavioral and
# stayed green through a bug that made the meter never render at all.

assert_has "task-card transform is bundled" 'buildTaskCards' "$OUT"
assert_has "location-chip transform is bundled" 'chipLocations' "$OUT"
assert_has "progress meter markup is bundled" 'progressbar' "$OUT"
assert_has "section-index scrollspy is bundled" 'IntersectionObserver' "$OUT"
assert_has "raw-HTML escaping is bundled" 'escapeHtml' "$OUT"
assert_has "page decodes the embedded payload" 'atob(' "$OUT"
assert_has "page decodes as UTF-8, not latin1" 'TextDecoder' "$OUT"

# --- the shape the task-card transform depends on ----------------------------
# This is the guard that was missing. The transform reads marked's output, and
# marked emits a *different* DOM shape for a loose list (blank lines between
# items, which the plan format uses) than for a tight one: the checkbox ends up
# inside a <p> rather than directly in the <li>. Handling only the tight shape
# made the entire transform inert on every real plan while the suite stayed
# green. Assert the real shape here, so a marked upgrade or a fixture edit that
# changes it fails instead of silently disabling the feature.

if command -v node >/dev/null 2>&1; then
	SHAPE=$(node -e '
		var m = require(process.argv[1]);
		var fs = require("fs");
		var html = m.parse(fs.readFileSync(process.argv[2], "utf8"));
		var loose = (html.match(/<li><p><input[^>]*type="checkbox"/g) || []).length;
		var tight = (html.match(/<li><input[^>]*type="checkbox"/g) || []).length;
		var checked = (html.match(/<input checked[^>]*type="checkbox"/g) || []).length;
		var all = (html.match(/type="checkbox"/g) || []).length;
		console.log(loose + " " + tight + " " + checked + " " + all);
	' "$DIR/../assets/marked.umd.js" "$FIXTURE" 2>"$TMP/shape-err")

	if [ -n "$SHAPE" ]; then
		set -- $SHAPE
		assert_count "marked emits 10 checkboxes for the fixture" 10 "$4"
		assert_count "marked marks 5 of them checked" 5 "$3"

		if [ "$1" -gt 0 ] || [ "$2" -gt 0 ]; then
			ok "fixture produces a checkbox shape the transform handles ($1 loose, $2 tight)"
		else
			no "fixture produces a checkbox shape the transform handles" "neither shape found"
		fi

		# The transform must cope with whichever shape is present. Loose is what
		# the plan format yields, so require the <p> fallback when it appears.
		if [ "$1" -gt 0 ]; then
			if grep -qF ":scope > p" "$DIR/../assets/template-head.html"; then
				ok "transform handles the loose (<p>-wrapped) shape marked actually emits"
			else
				no "transform handles the loose (<p>-wrapped) shape marked actually emits" \
					"marked emitted $1 loose items but the layer has no ':scope > p' fallback"
			fi
		fi
	else
		no "marked renders the fixture" "$(head -3 "$TMP/shape-err")"
	fi
else
	printf '  skip  marked output-shape checks (node not found)\n'
fi

# A syntax error in the layer would blank the page silently. Guard it when node
# is available; skip cleanly when it is not, so the suite needs no dependencies.
if command -v node >/dev/null 2>&1; then
	sed -n '/^<script>$/,/^<\/script>$/p' "$DIR/../assets/template-head.html" |
		sed '1d;$d' >"$TMP/layer.js"
	if node --check "$TMP/layer.js" 2>"$TMP/syntax-err"; then
		ok "plan-aware layer parses as valid JavaScript"
	else
		no "plan-aware layer parses as valid JavaScript" "$(head -3 "$TMP/syntax-err")"
	fi
else
	printf '  skip  plan-aware layer syntax check (node not found)\n'
fi

# --- --open ------------------------------------------------------------------
# A file:// URL is not reliably clickable in a terminal, so the skill opens the
# page instead of printing an address. PLAN_OPENER stands in for the real opener
# so none of this launches a browser.

RECORDER="$TMP/recorder.sh"
cat >"$RECORDER" <<'REC'
#!/bin/sh
printf '%s\n' "$1" >>"$RECORD_TO"
REC
chmod +x "$RECORDER"

RECORD_TO="$TMP/opened.log"
export RECORD_TO

: >"$RECORD_TO"
if PLAN_OPENER="$RECORDER" "$RENDER" --open "$FIXTURE" "$TMP/open1.html" >/dev/null 2>&1; then
	ok "--open exits 0"
else
	no "--open exits 0" "exit $?"
fi
assert_count "--open hands the rendered path to the opener" "$TMP/open1.html" "$(cat "$RECORD_TO")"

: >"$RECORD_TO"
PLAN_OPENER="$RECORDER" "$RENDER" "$FIXTURE" "$TMP/open2.html" >/dev/null 2>&1
assert_count "without --open nothing is opened" 0 "$(wc -l <"$RECORD_TO" | tr -d ' ')"

: >"$RECORD_TO"
if SSH_CONNECTION="1.2.3.4 5 6.7.8.9 22" PLAN_OPENER="$RECORDER" \
	"$RENDER" --open "$FIXTURE" "$TMP/open3.html" >/dev/null 2>"$TMP/ssh-note"; then
	ok "--open in a remote session still exits 0"
else
	no "--open in a remote session still exits 0" "exit $?"
fi
assert_count "--open in a remote session does not open" 0 "$(wc -l <"$RECORD_TO" | tr -d ' ')"
assert_has "--open in a remote session says where the file is" 'remote session' "$TMP/ssh-note"
truthy_file "--open still writes the page in a remote session" "$TMP/open3.html"

# A failing opener must not fail the render -- the page is on disk regardless.
if PLAN_OPENER=/nonexistent/opener "$RENDER" --open "$FIXTURE" "$TMP/open4.html" \
	>/dev/null 2>"$TMP/open-err"; then
	ok "a broken opener still exits 0"
else
	no "a broken opener still exits 0" "exit $?"
fi
truthy_file "a broken opener still writes the page" "$TMP/open4.html"

assert_exit "a flag in the path position exits 2" 2 "$RENDER" --bogus "$TMP/x.html"

# --- --draft -----------------------------------------------------------------
# The preview plan-it opens before the approval gate is rendered with --draft, so
# the page can say it is not approved yet. The flag sets one global that the
# plan-aware layer reads; everything else about the render is identical.

# Match the emitted statement, not the bare identifier: the plan-aware layer in
# template-head.html also mentions window.__planDraft in order to read it, so a
# looser pattern hits in every render and the absence check can never fail.
DRAFT_STMT='window.__planDraft = true;'

DRAFT_OUT="$TMP/draft.html"
if "$RENDER" --draft "$FIXTURE" "$DRAFT_OUT" >/dev/null 2>"$TMP/draft-err"; then
	ok "--draft exits 0"
else
	no "--draft exits 0" "exit $?; stderr: $(cat "$TMP/draft-err")"
fi
truthy_file "--draft writes the page" "$DRAFT_OUT"
assert_count "--draft sets the draft flag once" 1 "$(count_str "$DRAFT_STMT" "$DRAFT_OUT")"
assert_count "a default render sets no draft flag" 0 "$(count_str "$DRAFT_STMT" "$OUT")"

# The flag is emitted AFTER the vendored parser on purpose. A statement placed
# before it would demote a top-of-file "use strict" to a no-op expression for the
# whole script block -- marked has no such prologue today, but re-pinning it could
# introduce one, and the failure would be silent and total.
draft_line=$(grep -nF -- "$DRAFT_STMT" "$DRAFT_OUT" | head -1 | cut -d: -f1)
marked_line=$(grep -nF -- 'a markdown parser' "$DRAFT_OUT" | head -1 | cut -d: -f1)
if [ -n "$draft_line" ] && [ -n "$marked_line" ] && [ "$draft_line" -gt "$marked_line" ]; then
	ok "the draft flag is emitted after the vendored parser"
else
	no "the draft flag is emitted after the vendored parser" \
		"flag at line ${draft_line:-none}, parser at line ${marked_line:-none}"
fi

# --draft and --open are independent and must compose in either order.
: >"$RECORD_TO"
if PLAN_OPENER="$RECORDER" "$RENDER" --draft --open "$FIXTURE" "$TMP/draft-open.html" \
	>/dev/null 2>&1; then
	ok "--draft composes with --open"
else
	no "--draft composes with --open" "exit $?"
fi
assert_count "--draft --open hands the rendered path to the opener" \
	"$TMP/draft-open.html" "$(cat "$RECORD_TO")"

# --- behavioral checks in a real DOM (optional) -------------------------------
# Everything above is text inspection, which cannot tell whether the transforms
# actually do anything -- see the header of dom-test.mjs. When a jsdom install is
# reachable, run the real thing. jsdom is not a dependency of this repo, so this
# skips cleanly without one.

DOM_TEST="$DIR/dom-test.mjs"
if command -v node >/dev/null 2>&1 && [ -f "$DOM_TEST" ] &&
	node -e 'import(process.env.JSDOM_PATH || "jsdom").then(()=>process.exit(0),()=>process.exit(1))' 2>/dev/null; then
	printf '\n  -- DOM checks --\n'
	if node "$DOM_TEST" "$OUT" "$FIXTURE" "$DRAFT_OUT"; then
		ok "behavioral DOM checks pass"
	else
		no "behavioral DOM checks pass" "see the DOM check output above"
	fi
	printf '\n'
else
	printf '  skip  behavioral DOM checks (jsdom not reachable; set JSDOM_PATH to enable)\n'
fi

# --- Spec 9: failure modes ---------------------------------------------------

MISSING_OUT="$TMP/should-not-exist.html"

assert_exit "unreadable input exits 2" 2 "$RENDER" "$TMP/no-such-plan.md" "$MISSING_OUT"
assert_exit "missing output argument exits 2" 2 "$RENDER" "$FIXTURE"
assert_exit "too many arguments exits 2" 2 "$RENDER" "$FIXTURE" "$MISSING_OUT" extra
assert_exit "output path that is a directory exits 2" 2 "$RENDER" "$FIXTURE" "$TMP"
assert_exit "missing output directory exits 2" 2 "$RENDER" "$FIXTURE" "$TMP/nope/plan.html"

if [ -e "$MISSING_OUT" ]; then
	no "failed render leaves no partial output" "$MISSING_OUT was created"
else
	ok "failed render leaves no partial output"
fi

# The missing-asset path (exit 3) had no coverage at all. Exercise it against a
# copy of the script whose assets directory is deliberately incomplete.
ASSETDIR="$TMP/fake/assets"
mkdir -p "$ASSETDIR"
cp "$RENDER" "$TMP/fake/render-plan.sh"
for a in template-head.html template-mid.html template-tail.html; do
	: >"$ASSETDIR/$a"
done
assert_exit "missing asset exits 3" 3 "$TMP/fake/render-plan.sh" "$FIXTURE" "$TMP/fake/out.html"

# Writing the rendered page over the plan would destroy the source of truth, and
# the caller is handed two near-identical paths.
cp "$FIXTURE" "$TMP/self.md"
assert_exit "refuses to render a plan over itself" 2 "$RENDER" "$TMP/self.md" "$TMP/self.md"
if cmp -s "$TMP/self.md" "$FIXTURE"; then
	ok "the plan is left untouched when input and output are the same path"
else
	no "the plan is left untouched when input and output are the same path" "the plan was overwritten"
fi
assert_exit "refuses via a non-canonical path to the same file" 2 \
	"$RENDER" "$TMP/self.md" "$TMP/./self.md"

# Every failure path above returns before mktemp, so on its own the leak check
# below proves nothing. Force a failure *after* the temp file exists by making the
# output directory unwritable, which is what actually exercises the cleanup trap.
RO="$TMP/readonly"
mkdir -p "$RO"
: >"$RO/stale.html"
printf 'OLD CONTENT\n' >"$RO/stale.html"
chmod 555 "$RO"
if "$RENDER" "$FIXTURE" "$RO/stale.html" >/dev/null 2>&1; then
	no "an unwritable output exits non-zero" "exited 0"
else
	ok "an unwritable output exits non-zero"
fi
assert_has "an unwritable output leaves the previous page intact" 'OLD CONTENT' "$RO/stale.html"
chmod 755 "$RO"

# TMPDIR is this run's own directory, so anything found here was leaked by this
# run -- including by the post-mktemp failure just forced above.
leaked=$(find "$TMP" -maxdepth 1 -name 'render-plan.*' 2>/dev/null | wc -l | tr -d ' ')
assert_count "no temp files leaked, including after a post-mktemp failure" 0 "$leaked"

# --- the vendored parser matches its recorded checksum ------------------------
# MARKED-LICENSE.md is cited as the thing that catches an unintended marked
# change, so verify it rather than trusting it.

LICENSE="$DIR/../assets/MARKED-LICENSE.md"
MARKED="$DIR/../assets/marked.umd.js"
if command -v shasum >/dev/null 2>&1; then
	want=$(grep -o '[0-9a-f]\{64\}' "$LICENSE" | head -1)
	got=$(shasum -a 256 "$MARKED" | cut -d' ' -f1)
	assert_count "vendored marked matches the checksum in MARKED-LICENSE.md" "$want" "$got"
	wantb=$(grep -o '| Bytes | [0-9]* |' "$LICENSE" | grep -o '[0-9]*')
	gotb=$(wc -c <"$MARKED" | tr -d ' ')
	assert_count "vendored marked matches the recorded byte count" "$wantb" "$gotb"
else
	printf '  skip  vendored marked checksum (shasum not found)\n'
fi

# --- summary ----------------------------------------------------------------

printf '\n%s of %s checks passed\n\n' "$((checks - fails))" "$checks"
[ "$fails" -eq 0 ] || exit 1
