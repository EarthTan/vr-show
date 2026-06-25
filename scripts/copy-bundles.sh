#!/usr/bin/env bash
# Copy Tauri bundle outputs from src-tauri/target/release/bundle/<os>/ to ./dist-tauri/<os>/
# Usage: copy-bundles.sh <macos|windows|linux>
set -euo pipefail

OS_KEY="${1:-}"
if [[ -z "$OS_KEY" ]]; then
  echo "usage: $0 <macos|windows|linux>" >&2
  exit 1
fi

# Tauri's source bundle subdir is always "linux" on Linux, "macos" on macOS, "msi"/"nsis" on Windows.
# We map our friendly key to the actual subdirs and copy everything we find.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_BASE="$ROOT/src-tauri/target/release/bundle"
DST="$ROOT/dist-tauri/$OS_KEY"

case "$OS_KEY" in
  macos)
    SUBDIRS=(macos dmg)
    ;;
  windows)
    SUBDIRS=(msi nsis)
    ;;
  linux)
    SUBDIRS=(deb rpm appimage)
    ;;
  *)
    echo "unknown os key: $OS_KEY" >&2
    exit 1
    ;;
esac

if [[ ! -d "$SRC_BASE" ]]; then
  echo "no Tauri bundle output at $SRC_BASE — did tauri build run?" >&2
  exit 1
fi

rm -rf "$DST"
mkdir -p "$DST"

copied=0
for sub in "${SUBDIRS[@]}"; do
  src="$SRC_BASE/$sub"
  if [[ -d "$src" ]]; then
    # Copy any installable artifacts (files in the subdir, not its exploded tree contents)
    while IFS= read -r -d '' f; do
      cp "$f" "$DST/"
      echo "  $f -> $DST/"
      copied=$((copied + 1))
    done < <(find "$src" -maxdepth 1 -type f -print0)
  fi
done

if [[ $copied -eq 0 ]]; then
  echo "warning: no bundle files found for $OS_KEY (looked in: ${SUBDIRS[*]})" >&2
  exit 1
fi

echo ""
echo "==> $copied artifact(s) copied to $DST"
ls -lh "$DST"
