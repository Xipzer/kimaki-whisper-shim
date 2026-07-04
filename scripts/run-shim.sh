#!/usr/bin/env bash
# Run the Kimaki Whisper shim with auto-respawn.
# If the shim is killed (e.g. an OOM reaper / SIGKILL), it restarts instantly.
# Run this in a terminal tab and leave it open, or wrap it with a process
# manager / tuistory session.
#
#   ./scripts/run-shim.sh
#
# Ctrl+C stops the loop (the trap catches INT/TERM).
set -euo pipefail

# Resolve repo root (this script lives in scripts/).
cd "$(dirname "$0")/.."

# Make sure bun is on PATH regardless of how this is launched.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

trap 'echo "[run-shim] stopping"; exit 0' INT TERM

echo "[run-shim] starting shim with auto-respawn (Ctrl+C to stop)"
while true; do
  bun run src/index.ts || true
  code=$?
  echo "[run-shim] shim exited (code $code) — respawning in 1s..."
  sleep 1
done
