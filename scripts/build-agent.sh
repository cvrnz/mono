#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
out=src-tauri/resources/agent
mkdir -p "$out"
for pair in aarch64:arm64 x86_64:amd64; do
  target="${pair%%:*}-unknown-linux-musl"
  arch="${pair##*:}"
  rustup target list --installed | grep -qx "$target" || rustup target add "$target"
  cargo build -q -p mono-agent --profile agent --target "$target" --target-dir target/agent
  cp "target/agent/$target/agent/mono-agent" "$out/mono-agent-$arch"
done
