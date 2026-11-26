#!/bin/sh
# Builds the container helper for both Linux architectures in one cargo run, so they build in
# parallel. A helper is copied into resources only when it changed: Tauri watches that folder, and
# a new timestamp alone makes it rebuild the app.
set -eu
cd "$(dirname "$0")/.."
out=src-tauri/resources/agent
mkdir -p "$out"
installed=$(rustup target list --installed)
targets=""
for target in aarch64-unknown-linux-musl x86_64-unknown-linux-musl; do
  echo "$installed" | grep -qx "$target" || rustup target add "$target"
  targets="$targets --target $target"
done
# shellcheck disable=SC2086
cargo build -q -p mono-agent --profile agent $targets --target-dir target/agent
for pair in aarch64:arm64 x86_64:amd64; do
  built="target/agent/${pair%%:*}-unknown-linux-musl/agent/mono-agent"
  dest="$out/mono-agent-${pair##*:}"
  cmp -s "$built" "$dest" || cp "$built" "$dest"
done
