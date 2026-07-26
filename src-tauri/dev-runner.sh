#!/bin/sh
# Tauri's dev binary is unsigned, so macOS can't remember its Automation/TCC
# grants across launches (each build is "unidentified" -> a fresh Apple
# Events prompt every time). cargo builds, we ad-hoc sign, then run.
set -e
cargo build "$@"
target_dir=$(cargo metadata --format-version=1 --no-deps | jq -r .target_directory)
bin="$target_dir/debug/recipe-suggester"
codesign --force --deep --sign - "$bin"
exec "$bin"
