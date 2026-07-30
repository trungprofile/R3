#!/usr/bin/env bash
# Regenerate client/public/apple-touch-icon.png from client/public/icon.svg.
#
# This exists so the one binary file in the repo is not a mystery. A PNG cannot be
# diffed or reviewed, so the reproducible command that produced it is the only way a
# future reader can tell whether it still matches the brand mark next to it (A66).
#
# iOS uses <link rel="apple-touch-icon"> for the home-screen icon rather than the web
# manifest, and it will not accept the SVG the manifest points at, so this file is the
# difference between the pantry's heart on a volunteer's home screen and a screenshot
# of whatever page they happened to install from.
#
# Headless Chrome rather than a dependency: the icon has a `text` element in a system
# font, so rasterizing it correctly needs a real text shaper. rsvg-convert/sharp/resvg
# are not installed and `architecture.md §1.5` would rather not add one for a build
# step run roughly never. macOS `sips` cannot read SVG at all.
#
# The SVG is INLINED into a wrapper page rather than loaded with <img src>, which
# silently renders a broken-image placeholder under headless Chrome's file:// origin
# rules and writes a perfectly valid PNG of that placeholder.
#
# 180×180, full-bleed, opaque. iOS applies its own corner mask, so icon.svg's rounded
# corners are painted onto white here — left transparent, iOS composites them to black
# and the icon reads as a dark square.

set -euo pipefail

cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SRC="client/public/icon.svg"
OUT="client/public/apple-touch-icon.png"
SIZE=180

if [ ! -x "$CHROME" ]; then
  echo "error: no Chrome at $CHROME" >&2
  echo "       set CHROME=/path/to/chrome, or regenerate by opening $SRC" >&2
  echo "       in any browser at ${SIZE}x${SIZE} on white and exporting a PNG." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

{
  printf '%s\n' "<style>html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;overflow:hidden;background:#fff}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>"
  grep -v '^<?xml' "$SRC"
} > "$work/icon.html"

"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 \
  --window-size="${SIZE},${SIZE}" \
  --screenshot="$work/out.png" \
  "file://$work/icon.html" >/dev/null 2>&1

# A broken-image render is a valid PNG, so size is the cheap smoke test: the real
# icon is ~3.3kB, the placeholder ~1.2kB. Verify by eye after any change to icon.svg.
bytes=$(wc -c < "$work/out.png" | tr -d ' ')
if [ "$bytes" -lt 2000 ]; then
  echo "error: output is only ${bytes} bytes — Chrome probably rendered a broken image" >&2
  exit 1
fi

mv "$work/out.png" "$OUT"
echo "wrote $OUT (${bytes} bytes, ${SIZE}x${SIZE})"
