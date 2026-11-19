#!/bin/sh
# Fetches the public test corpora at pinned commits into .corpus/ (git-ignored), for the parser gate and the nightly
# whole-repository runs. Only the folders the tests read are checked out (a sparse, blob-filtered, shallow fetch).
# The sources are data: nothing in them is built or run. Some are GPL (Quantum ESPRESSO, Wannier90); they are never
# committed here, and only counts are recorded. miniWeather (BSD-2-Clause) is the showcase's OpenMP/OpenACC/MPI code.
#
#   scripts/fetch-corpus.sh            every corpus
#   scripts/fetch-corpus.sh lapack qe  some of them
#
# Needs git 2.27 or later. Runs on the host or in scripts/dev.sh.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${FDF_CORPUS:-$ROOT/.corpus}"

# name | repository | ref (for the record) | commit | folders
PINS='
lapack|https://github.com/Reference-LAPACK/lapack|v3.12.1|6ec7f2bc4ecf4c4a93496aa2fa519575bc0e39ca|SRC BLAS/SRC INSTALL
json-fortran|https://github.com/jacobwilliams/json-fortran|9.3.1|b7dc6b3227e16f69ec1061c7aa9eae4f1d2de943|src
qe|https://github.com/QEF/q-e|qe-7.6|9f93ddec427d2b9a45bb72d828c6d324f62fcabd|PW/src include
stdlib|https://github.com/fortran-lang/stdlib|stdlib-fpm (2026-11-18)|580064e56353f502f2106e6fe1f040d9f47b0638|src include
scalapack|https://github.com/Reference-ScaLAPACK/scalapack|v2.2.3|3e0da655fb07de5f1d76d6afb43f16ae17ca98c4|SRC PBLAS/SRC TOOLS
wannier90|https://github.com/wannier-developers/wannier90|v4.0.3|971c8b64bfe703c747a52655e1d59936597fe8ea|src
miniweather|https://github.com/mrnorman/miniWeather|main (2025-08-11)|b001069e1f7654914744641013e2bd408a9206fb|fortran
'

mkdir -p "$DEST"
echo "$PINS" | while IFS='|' read -r name url ref commit dirs; do
  [ -z "$name" ] && continue
  if [ $# -gt 0 ]; then
    case " $* " in *" $name "*) ;; *) continue ;; esac
  fi
  dir="$DEST/$name"
  if [ -f "$dir/.fetched" ] && [ "$(cat "$dir/.fetched")" = "$commit" ]; then
    echo "$name: up to date ($ref)"
    continue
  fi
  echo "$name: fetching $ref ($commit) — $dirs"
  rm -rf "$dir"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" remote add origin "$url"
  # shellcheck disable=SC2086
  git -C "$dir" sparse-checkout set --cone $dirs
  git -C "$dir" fetch -q --depth 1 --filter=blob:none origin "$commit"
  git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
  got="$(git -C "$dir" rev-parse HEAD)"
  if [ "$got" != "$commit" ]; then
    echo "$name: expected commit $commit, got $got" >&2
    exit 1
  fi
  rm -rf "$dir/.git"
  echo "$commit" > "$dir/.fetched"
done
