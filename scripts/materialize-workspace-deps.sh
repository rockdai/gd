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

  pkg_name="$(node -e "console.log(require(process.argv[1]).name)" "$pkg_json")"
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

  # Strip non-runtime artifacts: tests + nested node_modules don't need to ride along
  # into the FC code package (s.yaml uploads ./ which already contains packages/*/test/
  # at the source location, so keeping them in node_modules/@gd/<x>/ would double the
  # bytes uploaded). .mochawesome-reports lives under node_modules/ which is already
  # rm'd here, but list it explicitly in case tests get reconfigured later.
  rm -rf "$dest/test" "$dest/node_modules" "$dest/.mochawesome-reports"

  count=$((count + 1))
  echo "[materialize] $dest <= $pkg_dir (refreshed)"
done

echo "[materialize] done, refreshed $count workspace package(s)"
