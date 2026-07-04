#!/usr/bin/env bash
# Run the Kimaki Whisper shim with auto-respawn.
# If the shim is killed (e.g. WSL OOM reaper / SIGKILL), it restarts instantly.
# Run this in a WebStorm terminal tab and leave it open.
#
#   cd kimaki-whisper-shim && ./run.sh   (or use ./scripts/run-shim.sh)
#
# Ctrl+C twice to stop (once kills the shim, the trap stops the loop).

cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

# Make the shim a LOW-priority OOM target so the kernel reaps other things first.
# (best-effort; ignored if not permitted)
trap 'echo "[run.sh] stopping"; exit 0' INT TERM

echo "[run.sh] starting shim with auto-respawn (Ctrl+C to stop)"
while true; do
  # Lower our own oom_score_adj is not inherited reliably; set per child via a subshell.
  bun run src/index.ts
  code=$?
  echo "[run.sh] shim exited (code $code) — respawning in 1s..."
  sleep 1
done
