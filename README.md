# Kimaki Whisper Shim

Local, free, GPU-accelerated **voice-note transcription for Kimaki** — replaces
the paid Gemini/OpenAI cloud transcription with a self-hosted Whisper backend,
**without patching Kimaki**. Point one environment variable at the shim and your
Discord voice notes are transcribed on your own GPU.

## Why this exists

Kimaki transcribes Discord voice notes by sending an OpenAI/Gemini **chat
completion** that contains a text prompt + an audio file part, and forces the
model to call a `transcriptionResult` tool. A plain Whisper server (which speaks
`/v1/audio/transcriptions`) can't answer that request shape.

This shim bridges the gap: it **impersonates the OpenAI chat endpoint**, extracts
the audio, forwards it to a local Whisper server, and returns the transcript
wrapped as the exact `transcriptionResult` tool call Kimaki expects. No Kimaki
source changes — just set `OPENAI_BASE_URL`.

```
Discord voice note (.ogg)
      │
      ▼
Kimaki  --(OPENAI_BASE_URL=http://localhost:7070/v1)-->  SHIM (Bun, :7070)
                                                            │  extract audio part
                                                /v1/audio/transcriptions
                                                            ▼
                                            Whisper backend (GPU, :8000)
                                            speaches / whisper.cpp / faster-whisper
      ◄── transcriptionResult tool call ──────────────────┘
```

## Two moving parts

| Piece | Port | Role |
|---|---|---|
| **This shim** (Bun/TypeScript) | 7070 | Protocol translation + rule-based queue/agent detection |
| **A Whisper backend** | 8000 | Any OpenAI-compatible `/v1/audio/transcriptions` server on your GPU |

Pick whichever Whisper backend fits your hardware:

| Backend | Best for | Guide |
|---|---|---|
| **speaches** (faster-whisper) | NVIDIA / CUDA (Linux, WSL2) | below |
| **whisper.cpp** server | Apple Silicon (Metal), or CPU | [docs/setup-macos-metal.md](docs/setup-macos-metal.md) |
| **faster-whisper-server** | NVIDIA / CUDA alternative | drop-in, same API |

## Quick start (NVIDIA / speaches)

### 1. Run the shim

```bash
git clone <this-repo> kimaki-whisper-shim
cd kimaki-whisper-shim
cp .env.example .env          # edit WHISPER_BASE_URL if the backend is remote
bun install
./scripts/run-shim.sh         # auto-respawn wrapper; leave running
```

### 2. Run the Whisper backend (speaches, GPU)

```bash
# One-time: clone + install speaches
git clone https://github.com/speaches-ai/speaches.git ~/speaches-server
cd ~/speaches-server && uv venv && uv sync

# Launch with the CUDA/cuDNN lib-path fix + model preload
SPEACHES_DIR=~/speaches-server /path/to/kimaki-whisper-shim/scripts/run-speaches.sh
```

`scripts/run-speaches.sh` handles the WSL2 gotcha where only the base CUDA driver
is injected but cuDNN is not — it adds the venv's bundled `nvidia/*/lib` dirs to
`LD_LIBRARY_PATH` so faster-whisper (CTranslate2) can load `libcudnn_cnn.so.9`.
It also preloads the model and keeps it resident (`STT_MODEL_TTL=-1`) so there's
no cold-load penalty per voice note. All knobs are env vars — see the top of the
script.

### 3. Wire Kimaki (no patch)

```bash
export OPENAI_API_KEY=local-shim                  # any value; selects the "openai" provider
export OPENAI_BASE_URL=http://localhost:7070/v1   # routes to the shim
kimaki
```

Full instructions (clearing stored cloud keys, making it durable, troubleshooting)
in **[docs/kimaki-integration.md](docs/kimaki-integration.md)**.

## One command for the whole GPU stack (`run-stack.sh`)

The shim is a thin proxy — it needs speaches running behind it. Instead of
launching the two services separately, `scripts/run-stack.sh` brings up **both as
one process group**: it starts speaches, waits for it to be healthy, then starts
the shim. On stop, a single group-SIGTERM tears both down and frees the GPU.

```bash
SPEACHES_DIR=~/speaches-server ./scripts/run-stack.sh
```

This is the launcher to point Kimaki's **`/whisper-start`** at, so one command
spins up your entire transcription pipeline and `/whisper-stop` shuts it all down
(freeing VRAM). Configure it in Discord:

```
/whisper-setup  backend: Custom  command: /abs/path/to/kimaki-whisper-shim/scripts/run-stack.sh  health-url: http://localhost:7070/v1
```

or in a terminal:

```bash
kimaki whisper setup \
  --command "$PWD/scripts/run-stack.sh" \
  --health-url http://localhost:7070/health
kimaki whisper start   # brings up speaches + shim; /whisper-stop tears both down
```

Knobs (all env vars): `SPEACHES_DIR`, `SPEACHES_HEALTH`, `SPEACHES_WAIT_SECS`,
`SHIM_LAUNCHER`.

## Configuration (`.env`)

| Var | Default | Notes |
|---|---|---|
| `SHIM_PORT` | `7070` | Port the shim listens on |
| `WHISPER_BASE_URL` | `http://localhost:8000/v1` | Backend URL. Use the host LAN IP if the backend is on another machine (e.g. shim in WSL2, Whisper on Windows GPU) |
| `WHISPER_MODEL` | `Systran/faster-whisper-large-v3` | HF id for speaches; `whisper-1` for whisper.cpp |
| `WHISPER_API_KEY` | `none` | Most local backends need no key |
| `WHISPER_LANGUAGE` | `` | `""` = autodetect |
| `SHIM_API_KEY` | `` | If set, requires Kimaki's `OPENAI_API_KEY` to match |
| `SHIM_LOG_LEVEL` | `info` | `debug` \| `info` \| `error` |

## Smart features (rule-based, no second LLM)

The shim reproduces the behaviour Kimaki asks its transcription model to perform,
deterministically — no extra model call:

- **Queue detection** — "queue this message …" → sets `queueMessage: true` and
  strips the phrase from the transcript.
- **Agent selection** — "use the X agent" / "switch to X agent" → sets `agent`
  (only against the agent enum Kimaki provided). Plain speech like "plan the
  refactor" does **not** trigger it.

## Health & smoke test

```bash
curl http://localhost:7070/health      # {"ok":true,...}   (shim)
curl http://localhost:8000/health      # {"message":"OK"}  (speaches backend)

# Full end-to-end (downloads a JFK sample, transcribes, checks tool call):
./scripts/smoke-test.sh
```

## Split-machine setups (WSL2 + Windows GPU, etc.)

If the shim and the Whisper backend run on **different machines** (common: shim
in WSL2, speaches on the Windows GPU host), set `WHISPER_BASE_URL` to the
backend's **LAN IP**, not `localhost` — WSL2's `localhost` is not the Windows
host. Start the backend with `--host 0.0.0.0` so it's reachable.

## Repository layout

```
kimaki-whisper-shim/
├── src/
│   ├── index.ts        Bun HTTP server: OpenAI chat-completions -> Whisper
│   ├── whisper.ts      OpenAI-compatible /v1/audio/transcriptions client
│   ├── postprocess.ts  Rule-based queue + agent detection
│   └── config.ts       Env-driven config
├── scripts/
│   ├── run-shim.sh     Shim runner with auto-respawn
│   ├── run-speaches.sh Portable speaches launcher (CUDA/cuDNN fix + preload)
│   ├── run-stack.sh    Full GPU stack (speaches + shim) as one process group
│   └── smoke-test.sh   End-to-end verification
├── docs/
│   ├── kimaki-integration.md      Wiring Kimaki to the shim
│   ├── setup-macos-metal.md       Apple Silicon (whisper.cpp / Metal)
│   └── connect-kimaki-to-local-llm.md  Bonus: local LLM as a /model provider
├── .env.example
└── README.md
```

## Companion: run a local LLM in Kimaki too

Not required for transcription, but if you also want to serve a **local LLM**
(llama.cpp) as a selectable Kimaki `/model`, see
[docs/connect-kimaki-to-local-llm.md](docs/connect-kimaki-to-local-llm.md).

## License

MIT — see [LICENSE](LICENSE).
