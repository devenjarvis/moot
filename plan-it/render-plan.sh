#!/bin/sh
# Render a plan markdown file to a single self-contained HTML page.
#
#   render-plan.sh [--open] <plan.md> <out.html>
#
# --open  Open the rendered page in the default browser. Skipped in a remote
#         session, or when no platform opener exists. Never fails the render:
#         the page is written either way.
#
# Exit codes:
#   0  rendered (whether or not it opened)
#   1  an I/O failure, e.g. the output path is not writable
#   2  bad usage, unreadable input, missing output directory, or output == input
#   3  a template asset is missing
#
# This script knows nothing about markdown. It concatenates the templates, the
# plan source, and the vendored parser in one pass; all rendering happens in the
# browser. Markdown stays the single source of truth -- the HTML is generated and
# must never be hand-edited.

set -e

usage() {
	printf 'usage: %s [--open] <plan.md> <out.html>\n' "$(basename "$0")" >&2
	exit 2
}

do_open=no
while [ $# -gt 0 ]; do
	case $1 in
	--open) do_open=yes; shift ;;
	--) shift; break ;;
	--*) usage ;;
	*) break ;;
	esac
done

[ $# -eq 2 ] || usage

src=$1
out=$2

# Logical cd, not physical: this script is reached through the
# ~/.claude/skills/plan-it symlink, and the assets sit beside it in both views.
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
assets="$here/assets"

if [ ! -f "$src" ] || [ ! -r "$src" ]; then
	printf '%s: cannot read plan: %s\n' "$(basename "$0")" "$src" >&2
	exit 2
fi

if [ -d "$out" ]; then
	printf '%s: output path is a directory: %s\n' "$(basename "$0")" "$out" >&2
	exit 2
fi

out_dir=$(dirname -- "$out")
if [ ! -d "$out_dir" ]; then
	printf '%s: output directory does not exist: %s\n' "$(basename "$0")" "$out_dir" >&2
	exit 2
fi

# Refuse to write over the plan. The caller is handed two near-identical paths
# (.claude/plan.md and .claude/plan.html), so one slip would replace the source of
# truth -- the artifact build-it and ship-it read -- with its own rendering, and
# exit 0 while doing it.
src_real=$(CDPATH= cd -- "$(dirname -- "$src")" && pwd)/$(basename -- "$src")
out_real=$(CDPATH= cd -- "$out_dir" && pwd)/$(basename -- "$out")
if [ "$src_real" = "$out_real" ]; then
	printf '%s: refusing to overwrite the plan with its own rendering: %s\n' \
		"$(basename "$0")" "$src" >&2
	exit 2
fi

for asset in template-head.html template-mid.html template-tail.html marked.umd.js; do
	if [ ! -f "$assets/$asset" ]; then
		printf '%s: missing asset: %s\n' "$(basename "$0")" "$assets/$asset" >&2
		exit 3
	fi
done

# Assemble into a temp file and move it into place only on success, so a failure
# never leaves a half-written page behind.
tmp=$(mktemp "${TMPDIR:-/tmp}/render-plan.XXXXXX") || exit 2
trap 'rm -f "$tmp"' EXIT INT TERM

# The plan is embedded base64-encoded, and the page decodes it before parsing.
#
# The obvious alternative -- embed the markdown as text and escape any closing
# script tag so it cannot end the block early -- is not a round trip. Escaping
# rewrites `</script` to `<\/script`, but nothing distinguishes that from a plan
# that legitimately contains `<\/script` already, so un-escaping corrupts it.
# (Plans about this renderer contain exactly that string.) Encoding sidesteps the
# whole class: no byte of the plan can terminate the block, and the decode is
# exact. The cost is that the embedded source is no longer readable in a text
# editor -- acceptable, since plan.md sits next to it and is the source of truth.
{
	cat "$assets/template-head.html"
	base64 <"$src"
	cat "$assets/template-mid.html"
	cat "$assets/marked.umd.js"
	cat "$assets/template-tail.html"
} >"$tmp"

mv -- "$tmp" "$out"
trap - EXIT INT TERM

printf '%s\n' "$out"

# A file:// URL is not reliably clickable in a terminal -- Ghostty, for one, only
# linkifies web URLs, and no OSC 8 hyperlink survives the round trip through the
# agent harness. So open the page rather than print an address and hope.
if [ "$do_open" = yes ]; then
	if [ -n "${SSH_CONNECTION:-}${SSH_TTY:-}" ]; then
		printf '%s: remote session, not opening; read %s on the host\n' \
			"$(basename "$0")" "$out" >&2
	else
		# PLAN_OPENER exists so the test suite can observe this without launching
		# a browser.
		opener=${PLAN_OPENER:-}
		if [ -z "$opener" ]; then
			for candidate in open xdg-open; do
				if command -v "$candidate" >/dev/null 2>&1; then
					opener=$candidate
					break
				fi
			done
		fi

		if [ -z "$opener" ]; then
			printf '%s: no opener found (tried open, xdg-open); the page is at %s\n' \
				"$(basename "$0")" "$out" >&2
		elif ! "$opener" "$out" >/dev/null 2>&1; then
			# The render succeeded, so this is a note, not a failure.
			printf '%s: could not open the page; it is at %s\n' \
				"$(basename "$0")" "$out" >&2
		fi
	fi
fi
