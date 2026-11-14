#!/usr/bin/env bash
# The evidence for a UI change: run the browser suite, and leave a picture of every page in <out>.
# Fails if the suite fails or a page has no picture.
set -euo pipefail

# Every page of the web app (the tabs in src/web/App.tsx). A new page goes here and in tests/browser/pages.pw.ts.
PAGES=(list add following taste curator history)

out="${1:?usage: scripts/evidence.sh <out>}"
cd "$(dirname "$0")/.."
gallery=.playwright/gallery/desktop-chromium

rm -rf .playwright/gallery   # only this run's pictures count
bun run test:browser

mkdir -p "$out"
missing=0
for page in "${PAGES[@]}"; do
  if [ -s "$gallery/$page.png" ]; then cp "$gallery/$page.png" "$out/"; else echo "evidence: no screenshot of the $page page" >&2; missing=1; fi
done
[ "$missing" -eq 0 ] || exit 1
echo "evidence: ${#PAGES[@]} screenshots in $out"
