#!/usr/bin/env bash
#
# Print the notes of a release: .github/release-notes.md with the version filled in and the
# commit subjects since the previous release tag. The release workflow uses it; run it by hand
# to see what a release will say before tagging, or to rewrite the notes of an older release:
#
#   scripts/release-notes.sh v0.1.3                  # the tag may not exist yet: HEAD is used
#   scripts/release-notes.sh v0.1.2 > notes.md && gh release edit v0.1.2 --notes-file notes.md
#
# "Previous" is the newest v* tag on an earlier commit, so a tag that repeats another one on
# the same commit (v0.1.1 and v0.1.2) still lists what changed since the release before both.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

VERSION_RE='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'
VERSION="${1:-}"
if [[ ! "$VERSION" =~ $VERSION_RE ]]; then
  echo "usage: $0 vX.Y.Z (got '${VERSION}')" >&2
  exit 1
fi

TARGET="HEAD"
if git rev-parse -q --verify "refs/tags/${VERSION}" >/dev/null; then
  TARGET="$VERSION"
fi

PREVIOUS=""
if git rev-parse -q --verify "${TARGET}^" >/dev/null; then
  PREVIOUS="$(git describe --tags --abbrev=0 --match 'v[0-9]*' "${TARGET}^" 2>/dev/null || true)"
fi
if [[ -n "$PREVIOUS" ]] && [[ ! "$PREVIOUS" =~ $VERSION_RE ]]; then
  PREVIOUS=""
fi

CHANGES="$(mktemp)"
trap 'rm -f "$CHANGES"' EXIT
if [[ -n "$PREVIOUS" ]]; then
  git log --no-merges --format='- %s (%h)' "${PREVIOUS}..${TARGET}" > "$CHANGES"
  SINCE="$PREVIOUS"
else
  echo "- The first release." > "$CHANGES"
  SINCE="the beginning"
fi
if [[ ! -s "$CHANGES" ]]; then
  echo "- No code changes since ${SINCE}." > "$CHANGES"
fi

# The commit subjects are read from a file with getline, which takes text as it is (awk -v
# would turn a backslash in a subject into an escape). The two -v values passed the check above.
awk -v ver="$VERSION" -v since="$SINCE" -v changes="$CHANGES" '
  /<!-- CHANGES -->/ {
    while ((getline line < changes) > 0) print line
    close(changes)
    next
  }
  { gsub(/__VERSION__/, ver); gsub(/__PREVIOUS__/, since); print }
' .github/release-notes.md
