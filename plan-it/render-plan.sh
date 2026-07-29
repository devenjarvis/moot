#!/bin/sh
# Render a plan markdown file to a single self-contained HTML page.
#
#   render-plan.sh <plan.md> <out.html>
#
# Exit codes:
#   0  rendered
#   2  bad usage, unreadable input, or missing output directory
#   3  a template asset is missing
#
# This script knows nothing about markdown. It concatenates the templates, the
# plan source, and the vendored parser in one pass; all rendering happens in the
# browser. Markdown stays the single source of truth -- the HTML is generated and
# must never be hand-edited.

set -e

usage() {
	printf 'usage: %s <plan.md> <out.html>\n' "$(basename "$0")" >&2
	exit 2
}

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
