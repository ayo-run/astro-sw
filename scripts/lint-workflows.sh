#!/usr/bin/env sh
#
# Lints .github/workflows/ with actionlint.
#
# Used by both the CI "Lint workflows" job and the pre-commit hook, so the
# pinned version and its checksum are defined once, here.
#
# actionlint is fetched and checksum-verified rather than run via a third-party
# action or npm wrapper. This script polices the supply chain of the workflows,
# so it should not widen it — reviewdog/action-setup, the usual wrapper for
# actionlint, was compromised in the same March 2025 incident as tj-actions.
#
# Set DOWNLOAD_FAILURE_EXIT=0 to treat "could not reach GitHub" as a pass. The
# pre-commit hook does that, so an offline commit is not blocked by a linter.
# A checksum mismatch or a real lint error always fails, in both callers.

set -eu

VERSION=1.7.12
SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
ARCHIVE="actionlint_${VERSION}_linux_amd64.tar.gz"
URL="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${ARCHIVE}"

CACHE=".cache/actionlint"
BIN="${CACHE}/actionlint-${VERSION}"

if [ ! -x "${BIN}" ]; then
  mkdir -p "${CACHE}"
  echo "Fetching actionlint ${VERSION}..."
  if ! curl -fsSL -o "${CACHE}/${ARCHIVE}" "${URL}"; then
    echo "warning: could not download actionlint from ${URL}" >&2
    exit "${DOWNLOAD_FAILURE_EXIT:-1}"
  fi
  # Not guarded by DOWNLOAD_FAILURE_EXIT: a mismatch here means the bytes are
  # not the release we pinned, which is a stop-everything result offline too.
  echo "${SHA256}  ${CACHE}/${ARCHIVE}" | sha256sum --check --strict
  tar xzf "${CACHE}/${ARCHIVE}" -C "${CACHE}" actionlint
  mv "${CACHE}/actionlint" "${BIN}"
  rm -f "${CACHE}/${ARCHIVE}"
fi

# actionlint does not require shellcheck; it silently skips `run:` block checks
# when it cannot find it. That is a false green, not a lesser one. Say so
# loudly rather than report clean.
if ! command -v shellcheck >/dev/null 2>&1; then
  echo "warning: shellcheck not found on PATH." >&2
  echo "         'run:' blocks will NOT be checked, and CI checks them." >&2
  echo "         Install shellcheck to reproduce CI's result locally." >&2
fi

exec "${BIN}" -color
