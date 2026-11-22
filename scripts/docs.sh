#!/bin/sh
# Runs the documentation site (docs/) in a Node container, for machines without Node.
#
#   scripts/docs.sh dev      the dev server, at http://localhost:3000/docs (Ctrl-C ends it)
#   scripts/docs.sh build    a static export of the site, into docs/out, with the checks npm run build runs before
#                            and after it (docs/package.json: the pages against the code, then the export's links)
#   scripts/docs.sh stop     stops the dev server, or a build, that this script started
#
# The repository is mounted at /work, and docs/node_modules is a named Docker volume (fdf-docs-node-modules), so the
# host never gets the container's Linux binaries. npm install runs first whenever docs/package.json or
# docs/package-lock.json has changed since the last install. The container runs as the host user, so what it writes
# into the repository (.next, out, the lock file) stays theirs, on Linux too. Running dev or build again replaces a
# container left over from an earlier run.
#
# FDF_NODE_IMAGE picks the image (default node:24-bookworm) and FDF_DOCS_PORT the port on the host (default 3000).
# FDF_DOCS_POLL is how often, in ms, the dev server polls for changed files (default 1000). 0 relies on file events
# alone and saves the few per cent of a core that polling costs. That suits Linux, but through OrbStack, at least,
# Turbopack then misses pages added on the host, though it still sees edits.
# build passes NEXT_PUBLIC_BASE_PATH and NEXT_PUBLIC_SITE_URL through, for a site served from a sub-path.
# FDF_DOCS_NAME and FDF_DOCS_VOLUME name the container and the node_modules volume (default fdf-docs and
# fdf-docs-node-modules), so that a second checkout, such as a git worktree, can run its own site beside the first.
set -eu

# an app's minimal PATH (an editor's preview pane, say) may lack the folders Docker's CLI is installed in
command -v docker >/dev/null 2>&1 ||
  PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:${HOME:-}/.orbstack/bin:/Applications/Docker.app/Contents/Resources/bin"

IMAGE="${FDF_NODE_IMAGE:-node:24-bookworm}"
PORT="${FDF_DOCS_PORT:-3000}"
POLL="${FDF_DOCS_POLL:-1000}"
NAME="${FDF_DOCS_NAME:-fdf-docs}"
VOLUME="${FDF_DOCS_VOLUME:-fdf-docs-node-modules}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# npm install, when package.json or the lock file differs from the last install (their hash is kept in node_modules)
INSTALL='
set -e
stamp=node_modules/.fdf-installed
if [ "$(cat package.json package-lock.json 2>/dev/null | sha256sum)" != "$(cat "$stamp" 2>/dev/null)" ]; then
  echo "fdf-docs: npm install"
  npm install --no-audit --no-fund
  cat package.json package-lock.json | sha256sum > "$stamp"
fi
'

usage() {
  echo "usage: scripts/docs.sh dev | build | stop" >&2
  exit 2
}

[ $# -eq 1 ] || usage
cmd="$1"

IDS="$(id -u):$(id -g)"
# rootless Docker maps the container's root to the host user (and every other user to a sub-uid), so run as root there
case "$(docker info --format '{{.SecurityOptions}}' 2>/dev/null)" in *rootless*) IDS=0:0 ;; esac

# docker run with the repository, the volume, the host user and the environment that every step needs
set -- docker run --rm --init \
  -v "$ROOT":/work -v "$VOLUME":/work/docs/node_modules -w /work/docs \
  -u "$IDS" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e npm_config_update_notifier=false \
  -e NEXT_TELEMETRY_DISABLED=1
if [ -t 0 ] && [ -t 1 ]; then set -- "$@" -it; fi

prepare() {
  # the volume's mount point, made here so that it belongs to the host user and not to Docker's root
  mkdir -p "$ROOT/docs/node_modules"
  # a new volume belongs to root: hand it to the host user, who runs everything else
  docker run --rm -v "$VOLUME":/nm "$IMAGE" \
    sh -c "[ \"\$(stat -c %u:%g /nm)\" = '$IDS' ] || chown -R '$IDS' /nm"
  "$@" "$IMAGE" sh -c "$INSTALL"
}

case "$cmd" in
  dev)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    prepare "$@"
    echo "fdf-docs: http://localhost:$PORT/docs (Ctrl-C, or scripts/docs.sh stop, ends it)"
    # The watchers poll, because the host's file events do not reach every container, and where they do (OrbStack)
    # Turbopack still misses new files: Turbopack's through DOCS_POLL (read by docs/next.config.mjs), fumadocs-mdx's
    # (chokidar) through CHOKIDAR_*. Turbopack's polling prints a few harmless "watch error ... NotFound" lines, for
    # paths the module resolver looked for.
    # The install runs before this container, so the port opens only when the server is about to answer.
    case "$POLL" in
      '' | *[!0-9]* | 0) set -- "$@" -e DOCS_POLL=0 -e CHOKIDAR_USEPOLLING=0 ;;
      *) set -- "$@" -e DOCS_POLL="$POLL" -e CHOKIDAR_USEPOLLING=1 -e CHOKIDAR_INTERVAL="$POLL" ;;
    esac
    exec "$@" --name "$NAME" -p "127.0.0.1:$PORT:3000" \
      "$IMAGE" node_modules/.bin/next dev --hostname 0.0.0.0 --port 3000
    ;;
  build)
    docker rm -f "$NAME-build" >/dev/null 2>&1 || true
    prepare "$@"
    exec "$@" --name "$NAME-build" \
      -e DOCS_EXPORT=1 -e NEXT_PUBLIC_BASE_PATH -e NEXT_PUBLIC_SITE_URL \
      "$IMAGE" npm run build
    ;;
  stop)
    stopped=""
    for c in "$NAME" "$NAME-build"; do
      if docker container inspect "$c" >/dev/null 2>&1; then
        docker stop -t 5 "$c" >/dev/null 2>&1 || docker rm -f "$c" >/dev/null 2>&1 || true
        echo "fdf-docs: stopped $c"
        stopped=1
      fi
    done
    [ -n "$stopped" ] || echo "fdf-docs: nothing to stop"
    ;;
  *) usage ;;
esac
