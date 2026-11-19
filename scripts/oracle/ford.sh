#!/bin/sh
# Runs FORD 7.0.13 (GPL, development only) on the given folders and writes its parsed model to .cache/ford/dump.json,
# for scripts/oracle/compare-ford.mjs. The folders must be inside the repository (for example .corpus/json-fortran/src).
#
#   scripts/oracle/ford.sh .corpus/json-fortran/src
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${FDF_FORD_IMAGE:-fdf-ford:7.0.13}"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -t "$IMAGE" "$ROOT/scripts/oracle/ford"
fi
mkdir -p "$ROOT/.cache/ford"
FILES=""
for d in "$@"; do
  for f in $(cd "$ROOT" && find "$d" -type f \( -name '*.f' -o -name '*.F' -o -name '*.f90' -o -name '*.F90' \) | sort); do
    FILES="$FILES /work/$f"
  done
done
# shellcheck disable=SC2086
docker run --rm -v "$ROOT":/work:ro -v "$ROOT/.cache/ford":/out "$IMAGE" \
  python -I /work/scripts/oracle/ford/ford_dump.py --no-highlight --no-locals \
  --preprocessor "cpp -traditional-cpp -E -undef -nostdinc" -o /out/dump.json $FILES
echo "wrote .cache/ford/dump.json"
