#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES_DIR="$ROOT/packages"
GD_NM_DIR="$ROOT/node_modules/@gd"

if [ ! -d "$PACKAGES_DIR" ]; then
  echo "[materialize] no packages/ directory at $PACKAGES_DIR" >&2
  exit 1
fi

mkdir -p "$GD_NM_DIR"

count=0
for pkg_dir in "$PACKAGES_DIR"/*/; do
  pkg_dir="${pkg_dir%/}"
  pkg_json="$pkg_dir/package.json"
  if [ ! -f "$pkg_json" ]; then
    echo "[materialize] skip $pkg_dir (no package.json)" >&2
    continue
  fi

  pkg_name="$(node -p "require('$pkg_json').name")"
  case "$pkg_name" in
    @gd/*) ;;
    *)
      echo "[materialize] skip $pkg_dir (name '$pkg_name' not under @gd/*)" >&2
      continue
      ;;
  esac

  pkg_short="${pkg_name#@gd/}"
  dest="$GD_NM_DIR/$pkg_short"

  rm -rf "$dest"
  cp -R "$pkg_dir" "$dest"
  count=$((count + 1))
  echo "[materialize] $dest <= $pkg_dir (refreshed)"
done

echo "[materialize] done, refreshed $count workspace package(s)"
