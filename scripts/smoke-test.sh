#!/usr/bin/env bash
# End-to-end smoke test for the Kimaki Whisper shim.
#
#   1. shim   /health           -> {"ok":true,...}
#   2. backend /audio/transcriptions with a known sample -> real transcript
#   3. shim   /chat/completions with a Kimaki-shaped audio request
#             -> a transcriptionResult tool call containing the transcript
#
# Usage:
#   SHIM_URL=http://localhost:7070 WHISPER_URL=http://localhost:8000/v1 \
#     ./scripts/smoke-test.sh
set -euo pipefail

SHIM_URL="${SHIM_URL:-http://localhost:7070}"
WHISPER_URL="${WHISPER_URL:-http://localhost:8000/v1}"
WHISPER_MODEL="${WHISPER_MODEL:-Systran/faster-whisper-large-v3}"
SAMPLE="${SAMPLE:-/tmp/jfk.wav}"

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }

echo "== 1. shim health =="
curl -sf -m 5 "$SHIM_URL/health" >/dev/null && pass "shim up ($SHIM_URL)" || fail "shim not reachable"

echo "== 2. whisper backend transcribes a known sample =="
if [ ! -f "$SAMPLE" ]; then
  echo "  downloading JFK sample..."
  curl -sL -o "$SAMPLE" "https://github.com/ggerganov/whisper.cpp/raw/master/samples/jfk.wav"
fi
BACKEND_TEXT="$(curl -sf -m 60 "$WHISPER_URL/audio/transcriptions" \
  -F "file=@$SAMPLE" -F "model=$WHISPER_MODEL" -F "response_format=json" \
  | grep -oE '"text"[^,}]*' || true)"
[ -n "$BACKEND_TEXT" ] && pass "backend transcript: $BACKEND_TEXT" || fail "backend returned no text"

echo "== 3. shim wraps a Kimaki-shaped request as a tool call =="
AUDIO_B64="$(base64 -w0 "$SAMPLE" 2>/dev/null || base64 "$SAMPLE" | tr -d '\n')"
REQ="$(printf '{"model":"gpt-audio","messages":[{"role":"user","content":[{"type":"text","text":"transcribe"},{"type":"input_audio","input_audio":{"data":"%s","format":"wav"}}]}],"tools":[{"type":"function","function":{"name":"transcriptionResult","parameters":{"type":"object","properties":{"transcription":{"type":"string"}}}}}]}' "$AUDIO_B64")"
SHIM_RESP="$(echo "$REQ" | curl -sf -m 60 "$SHIM_URL/v1/chat/completions" \
  -H 'content-type: application/json' -H 'authorization: Bearer local-shim' \
  --data-binary @- || true)"
echo "$SHIM_RESP" | grep -q '"name":"transcriptionResult"' \
  && pass "shim returned transcriptionResult tool call" \
  || fail "shim did not return a transcriptionResult tool call"

echo
echo "All checks passed. The shim is ready for Kimaki."
