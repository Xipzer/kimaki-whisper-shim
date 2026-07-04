#!/usr/bin/env bash
# Launch the speaches Whisper backend (GPU, OpenAI-compatible) — portable.
#
# speaches is a self-hosted, OpenAI-compatible speech server that runs
# faster-whisper (CTranslate2) on the GPU. This script starts it with the
# CUDA/cuDNN library path fix that WSL2 (and some bare-metal Linux) need.
#
# WHY THE LD_LIBRARY_PATH DANCE:
#   WSL2 injects only the base CUDA driver, not cuDNN. faster-whisper needs
#   libcudnn_cnn.so.9 etc., which pip installs into the venv under
#   .venv/lib/python*/site-packages/nvidia/*/lib. We add every one of those
#   dirs to LD_LIBRARY_PATH so CTranslate2 can dlopen them. On native Linux
#   with a system cuDNN this is harmless (paths just may not exist).
#
# USAGE:
#   1. git clone https://github.com/speaches-ai/speaches.git ~/speaches-server
#   2. cd ~/speaches-server && uv venv && uv sync   (installs into .venv)
#   3. Set SPEACHES_DIR below (or export it) to that checkout, then run this.
#
#   SPEACHES_DIR=~/speaches-server ./scripts/run-speaches.sh
#
# All knobs are env vars with sensible defaults:
#   SPEACHES_DIR   path to the speaches checkout containing .venv   (required)
#   SPEACHES_HOST  bind host                                        (0.0.0.0)
#   SPEACHES_PORT  bind port                                        (8000)
#   WHISPER_MODEL  HF model id to preload + keep resident           (large-v3)
#   STT_MODEL_TTL  seconds to keep model in VRAM (-1 = never unload) (-1)
#   HF_HUB_CACHE   HuggingFace model cache dir                      (~/.cache/...)
set -euo pipefail

SPEACHES_DIR="${SPEACHES_DIR:-$HOME/speaches-server}"
SPEACHES_HOST="${SPEACHES_HOST:-0.0.0.0}"
SPEACHES_PORT="${SPEACHES_PORT:-8000}"
WHISPER_MODEL="${WHISPER_MODEL:-Systran/faster-whisper-large-v3}"
STT_MODEL_TTL="${STT_MODEL_TTL:--1}"
HF_HUB_CACHE="${HF_HUB_CACHE:-$HOME/.cache/huggingface/hub}"

if [ ! -d "$SPEACHES_DIR" ]; then
  echo "error: SPEACHES_DIR '$SPEACHES_DIR' does not exist." >&2
  echo "       Clone speaches first:  git clone https://github.com/speaches-ai/speaches.git $SPEACHES_DIR" >&2
  exit 1
fi

cd "$SPEACHES_DIR"

VENV="$PWD/.venv"
if [ ! -x "$VENV/bin/uvicorn" ]; then
  echo "error: no venv at '$VENV'. Run 'uv venv && uv sync' in $SPEACHES_DIR first." >&2
  exit 1
fi

# Collect every bundled nvidia/*/lib dir onto LD_LIBRARY_PATH (cuDNN fix).
NV="$VENV/lib"/python*/site-packages/nvidia
EXTRA_LIBS=""
for d in $NV/*/lib; do
  [ -d "$d" ] && EXTRA_LIBS="$EXTRA_LIBS:$d"
done

export LD_LIBRARY_PATH="${EXTRA_LIBS#:}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}:/usr/lib/wsl/lib"
export HF_HUB_CACHE
export PATH="$HOME/.local/bin:$PATH"   # picks up a user-local static ffmpeg if present

# Keep the model resident so there's no ~30s cold-load per request, and preload
# it at boot so even the first voice note is warm.
export STT_MODEL_TTL
export PRELOAD_MODELS="[\"$WHISPER_MODEL\"]"

echo "[run-speaches] dir=$SPEACHES_DIR model=$WHISPER_MODEL ttl=$STT_MODEL_TTL"
echo "[run-speaches] listening on http://$SPEACHES_HOST:$SPEACHES_PORT"

exec "$VENV/bin/uvicorn" --factory \
  --host "$SPEACHES_HOST" --port "$SPEACHES_PORT" \
  speaches.main:create_app
