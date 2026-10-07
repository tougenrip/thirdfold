#!/usr/bin/env bash
# Runs browser tests one at a time on this machine (they share vitest's port 63315).
# Waits for the others under a kernel lock (released when the run exits, even on a crash),
# and kills a run that hangs. Run it in the background and wait for it to exit: never
# poll its output in a loop.
#   scripts/render-test.sh src/lib/tabletop/walls.svelte.spec.ts
#   THIRDFOLD_SHARD=3/18 scripts/render-test.sh src/lib/tabletop/program-count.svelte.spec.ts
#   RENDER_CMD="npm run test:golden" scripts/render-test.sh
# RENDER_WAIT (s, default 10800) bounds the wait for the lock, RENDER_TIMEOUT (s, 1800) the run.
set -uo pipefail
lock=/tmp/thirdfold-render.lock
exec 9>"$lock"
if ! flock -w "${RENDER_WAIT:-10800}" 9; then
	echo "render-test: gave up waiting for $lock" >&2
	exit 124
fi
cmd=${RENDER_CMD:-"npx vitest run --project client"}
THIRDFOLD_RENDER=1 timeout -k 30 "${RENDER_TIMEOUT:-1800}" $cmd "$@"
status=$?
[ $status -eq 124 ] && echo "render-test: timed out after ${RENDER_TIMEOUT:-1800} s" >&2
exit $status
