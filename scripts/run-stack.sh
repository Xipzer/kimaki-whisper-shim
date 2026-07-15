#!/usr/bin/env bash
# Bring up the full GPU transcription stack as ONE process group:
#   speaches (faster-whisper large-v3, CUDA) on :8000  ─backend─►  shim on :7070
#
# Designed to be the `command` that Kimaki's /whisper-start launches, so a single
# /whisper-start spins up the whole pipeline and /whisper-stop (group SIGTERM)
# tears it all down. Both children are killed when this script's group is signalled.
set -uo pipefail

# This script lives in scripts/; the shim repo root (with run.sh) is one level up.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPEACHES_DIR="${SPEACHES_DIR:-$HOME/speaches-server}"
SHIM_DIR="${SHIM_DIR:-$REPO_ROOT}"
SHIM_LAUNCHER="${SHIM_LAUNCHER:-$SHIM_DIR/scripts/run-shim.sh}"
SPEACHES_HEALTH="${SPEACHES_HEALTH:-http://localhost:8000/health}"
SPEACHES_WAIT_SECS="${SPEACHES_WAIT_SECS:-120}"

log() { echo "[run-stack] $*"; }

# Kill the whole child tree on exit/stop so /whisper-stop frees the GPU cleanly.
pids=()
cleanup() {
  log "stopping stack..."
  for pid in "${pids[@]}"; do
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# 1. speaches (GPU whisper backend) — new process group so we can group-kill it.
# Uses the repo's portable launcher (CUDA/cuDNN lib-path fix + model preload).
log "starting speaches (SPEACHES_DIR=$SPEACHES_DIR)..."
SPEACHES_DIR="$SPEACHES_DIR" setsid "$SHIM_DIR/scripts/run-speaches.sh" &
pids+=("$!")

# 2. wait for speaches to answer health before starting the shim.
log "waiting for speaches at $SPEACHES_HEALTH (up to ${SPEACHES_WAIT_SECS}s)..."
deadline=$(( $(date +%s) + SPEACHES_WAIT_SECS ))
until curl -sf -m 3 "$SPEACHES_HEALTH" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    log "speaches did not become healthy in time — starting shim anyway"
    break
  fi
  sleep 2
done
log "speaches ready (or timed out); starting shim..."

# 3. shim (:7070) via the repo's auto-respawn launcher.
setsid "$SHIM_LAUNCHER" &
pids+=("$!")

log "stack up: speaches :8000 + shim :7070"
# Block until any child exits (or a stop signal fires the trap).
wait -n 2>/dev/null || wait
cleanup
