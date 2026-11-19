#!/bin/sh
# Runs a command in a Node container with the repository mounted at /work, for machines without Node.
#
#   scripts/dev.sh                     an interactive shell
#   scripts/dev.sh npm test            the tests
#   scripts/dev.sh node scripts/gate.mjs
#
# FDF_NODE_IMAGE picks the image (default node:24-bookworm, which also has git, curl and cpp).
# FDF_PRIVATE=/abs/path mounts a folder read-only at /private, for local acceptance tests on code that must not leave
# this machine.
set -eu

IMAGE="${FDF_NODE_IMAGE:-node:24-bookworm}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ $# -eq 0 ]; then set -- bash; fi

TTY=""
if [ -t 0 ] && [ -t 1 ]; then TTY="-it"; fi

PRIVATE=""
if [ -n "${FDF_PRIVATE:-}" ]; then PRIVATE="-v ${FDF_PRIVATE}:/private:ro"; fi

# shellcheck disable=SC2086
exec docker run --rm $TTY \
  -v "$ROOT":/work -w /work \
  $PRIVATE \
  -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -u "$(id -u):$(id -g)" \
  "$IMAGE" "$@"
