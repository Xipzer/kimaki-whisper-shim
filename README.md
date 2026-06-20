# Kimaki Whisper Shim

Local, free, GPU-accelerated voice-note transcription for Kimaki — replaces the
paid Gemini/OpenAI transcription with a local Whisper backend, **without patching
Kimaki**.

## What it does

Kimaki transcribes Discord voice notes by sending an OpenAI/Gemini **chat
completion** request that contains a text prompt + an audio file part, and forces
the model to call a `transcriptionResult` tool. This shim impersonates that
OpenAI chat endpoint, extracts the audio, sends it to a local Whisper server
(`speaches`), and returns the transcript wrapped as the expected tool call.

```
Discord voice note
      │
      ▼
Kimaki  --(OPENAI_BASE_URL=http://localhost:7070/v1)-->  SHIM (Bun, :7070)
                                                            │
                                          /v1/audio/transcriptions
                                                            ▼
                                          speaches (GPU Whisper, :8000)
                                                            │
                                              4070 SUPER (CUDA, WSL2)
      ◄── transcriptionResult tool call ──────────────────┘
```

## Components

| Piece | Where | Port | Notes |
|---|---|---|---|
| `speaches` | `~/speaches-server` | 8000 | faster-whisper large-v3 on the 4070 Super |
| this shim | `~/WebstormProjects/kimaki-whisper-shim` | 7070 | protocol translation + queue/agent rules |
| Kimaki | your shell | — | points `OPENAI_BASE_URL` at the shim |

## Start everything

```bash
# 1. Start the Whisper backend (GPU)
cd ~/speaches-server && ./run-speaches.sh        # or via tuistory: -s speaches

# 2. Start the shim
cd ~/WebstormProjects/kimaki-whisper-shim && bun run src/index.ts

# 3. Wire Kimaki (in the shell that runs kimaki), then restart it
export OPENAI_API_KEY=local-shim                  # any value; selects "openai" provider
export OPENAI_BASE_URL=http://localhost:7070/v1   # routes to the shim
kimaki
```

> `run-speaches.sh` sets `LD_LIBRARY_PATH` to the venv's bundled CUDA/cuDNN libs
> (WSL only injects the base CUDA driver, not cuDNN) and `HF_HUB_CACHE` to ext4.

## Config (.env)

See `.env.example`. Key vars:

- `SHIM_PORT` (7070)
- `WHISPER_BASE_URL` (`http://localhost:8000/v1`)
- `WHISPER_MODEL` (`Systran/faster-whisper-large-v3`)
- `WHISPER_LANGUAGE` ("" = autodetect)
- `SHIM_API_KEY` ("" = accept any; set to require Kimaki's OPENAI_API_KEY to match)

## Smart features (rule-based, no second LLM)

- **Queue detection**: "queue this message …" → sets `queueMessage: true` and strips the phrase.
- **Agent selection**: "use the X agent" / "switch to X agent" → sets `agent` (only the
  agent enum Kimaki provided). Plain words like "plan the refactor" do NOT trigger it.

## Health

```bash
curl http://localhost:7070/health      # {"ok":true,...}
curl http://localhost:8000/health      # {"message":"OK"}
```

## Verified

- speaches transcribes on the 4070 Super (CUDA), ~1-4s per voice note.
- Shim returns a valid `transcriptionResult` tool call for a Kimaki-shaped
  chat-with-audio request.
- Queue/agent rules pass unit cases including negatives.
