#!/bin/sh
# Builds the page into target/page, then updates dist/ with only the files that changed. Tauri
# embeds dist/ into the app and watches it, so rewriting every file (as `vite build` does) would
# rebuild the app even when the page is the same.
set -eu
cd "$(dirname "$0")/.."
tsc -b
vite build --outDir target/page --emptyOutDir
mkdir -p dist
rsync -r --checksum --delete target/page/ dist/   # no -t: unchanged files keep their timestamps
