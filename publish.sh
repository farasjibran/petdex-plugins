#!/usr/bin/env bash
#
# Publish a plugin version to the marketplace.
#
#   ./publish.sh <version>          e.g. ./publish.sh 1.6.1
#   ./publish.sh <version> <dir>    publish a different plugin folder
#
# What it does, and why each step exists:
#
#   1. validate            a plugin that fails validation still downloads fine
#                          and only breaks at runtime, so it must never ship
#   2. version guard       the marketplace compares the RELEASE TAG against the
#                          manifest version to offer updates. They must agree,
#                          or it offers the same update forever.
#   3. zip, files at root  the installer expects plugin.json at the archive
#                          root. A wrapper directory also works but GitHub's
#                          own repo archives wrap, so build it explicitly.
#   4. gh release create   this is what makes GitHub compute and publish the
#                          sha256 the app verifies the download against. There
#                          is no digest for a hand-made zip.
#
set -euo pipefail

VERSION="${1:?usage: publish.sh <version> [plugin-dir]}"
PLUGIN_DIR="${2:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$PLUGIN_DIR" ]; then
  # exactly one plugin folder, if there is only one
  candidates=(*/)
  if [ "${#candidates[@]}" -ne 1 ]; then
    echo "more than one plugin folder; name one explicitly:"
    printf '  %s\n' "${candidates[@]}"
    exit 2
  fi
  PLUGIN_DIR="${candidates[0]}"
fi

case "$PLUGIN_DIR" in
  */) PLUGIN_DIR="${PLUGIN_DIR%/}" ;;
esac

if [ ! -d "$PLUGIN_DIR" ]; then
  echo "no such plugin folder: $PLUGIN_DIR" >&2
  exit 2
fi

# 1. validate -------------------------------------------------------------
VALIDATOR="${BENTOMUX:-$REPO_ROOT/../Bentomux-v2/src-tauri/target/debug/bentomux}"
if [ ! -x "$VALIDATOR" ]; then
  echo "validator not built at $VALIDATOR" >&2
  echo "build it:  cargo build --manifest-path ../Bentomux-v2/src-tauri/Cargo.toml" >&2
  echo "or point BENTOMUX at an installed bentomux binary." >&2
  exit 2
fi

echo "==> validating $PLUGIN_DIR"
"$VALIDATOR" --plugin-validate "$PLUGIN_DIR" || exit $?

# 2. version guard --------------------------------------------------------
ACTUAL="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$PLUGIN_DIR/plugin.json")"
if [ "$ACTUAL" != "$VERSION" ]; then
  echo "plugin.json says version $ACTUAL but you asked for $VERSION" >&2
  echo "fix plugin.json, or re-run with $ACTUAL." >&2
  exit 1
fi

# 3. zip ------------------------------------------------------------------
ZIP="$REPO_ROOT/.build/$PLUGIN_DIR-$VERSION.zip"
mkdir -p "$(dirname "$ZIP")"
rm -f "$ZIP"

echo "==> zipping $PLUGIN_DIR"
# -x keeps macOS junk and anything a future tool drops in out of the payload.
#   Timestamps still differ per build, which is fine: the digest is computed
#   from whatever bytes actually get uploaded.
( cd "$PLUGIN_DIR" && zip -qr "$ZIP" . -x '*.DS_Store' '__MACOSX/*' '.git/*' )

# a wrapper directory would also install, but the marketplace docs and the
# platform spec both describe files at the root, so check rather than assume
if ! unzip -l "$ZIP" | grep -q ' plugin\.json$'; then
  echo "plugin.json is not at the archive root — check what got zipped:" >&2
  unzip -l "$ZIP" >&2
  exit 1
fi
echo "    $(unzip -l "$ZIP" | tail -1 | awk '{print $2" bytes, "$3" files"}'), plugin.json at root"

# 4. release --------------------------------------------------------------
echo "==> creating release v$VERSION"
gh release create "v$VERSION" "$ZIP" \
  --title "${PLUGIN_DIR} $VERSION" \
  --notes "${PLUGIN_DIR} ${VERSION}."

cat <<TIP

Published v$VERSION.

  - the marketplace caches for six hours; a user hits Refresh to see it now
  - stars and the download count come straight from this repo
  - to publish again, bump plugin.json and run ./publish.sh <new-version>

A published version is immutable: GitHub's digest covers the exact zip bytes,
so re-uploading this version makes every install of it fail on a digest
mismatch. Cut a new version instead.
TIP