# macOS (Apple Silicon) setup — Metal Whisper backend

Run the shim + a **Metal-accelerated** Whisper backend on an Apple Silicon Mac
(M-series). The shim code is identical to the Linux/CUDA build — only the Whisper
backend differs, and Metal is **simpler** (no CUDA/cuDNN wrangling).

## Architecture

```
Discord voice note (.ogg)
      │
      ▼
Kimaki  --(OPENAI_BASE_URL -> shim)-->  SHIM (Bun, :7070)
                                          │  /v1/audio/transcriptions
                                          ▼
                              whisper.cpp server (:8000)
                                          │
                                    Apple Silicon GPU (Metal)
      ◄── transcriptionResult tool call ─┘
```

## 0. Prerequisites

```bash
# Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Bun (shim runtime) + ffmpeg (audio decode) + whisper.cpp (Metal backend)
brew install oven-sh/bun/bun ffmpeg whisper-cpp
```

## 1. Whisper backend — whisper.cpp (Metal, OpenAI-compatible)

whisper.cpp auto-uses Metal on Apple Silicon and has a built-in OpenAI-compatible
`/v1/audio/transcriptions` route.

```bash
mkdir -p ~/whisper-models
curl -L -o ~/whisper-models/ggml-large-v3.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin"

whisper-server \
  -m ~/whisper-models/ggml-large-v3.bin \
  --host 0.0.0.0 --port 8000 \
  --inference-path /v1/audio/transcriptions -t 8
```

Verify:

```bash
curl -L -o /tmp/jfk.wav "https://github.com/ggerganov/whisper.cpp/raw/master/samples/jfk.wav"
curl -s http://localhost:8000/v1/audio/transcriptions \
  -F file=@/tmp/jfk.wav -F model=whisper-1 -F response_format=json
# expect: "...ask not what your country can do for you..."
```

## 2. The shim

Clone this repo, then:

```bash
cd kimaki-whisper-shim
cp .env.example .env      # set WHISPER_MODEL=whisper-1 for whisper.cpp
bun install
./scripts/run-shim.sh
```

`.env` for the whisper.cpp backend:

```
SHIM_PORT=7070
WHISPER_BASE_URL=http://localhost:8000/v1
WHISPER_MODEL=whisper-1
WHISPER_API_KEY=none
```

## 3. Wire Kimaki

See [kimaki-integration.md](./kimaki-integration.md). On macOS the shell rc is
`~/.zshrc`. Clear any stored cloud key, set `OPENAI_API_KEY` / `OPENAI_BASE_URL`,
restart Kimaki.

## Performance (Apple Silicon, warm)

| Audio length | Approx. time |
|---|---|
| 30 sec | ~3–6 s |
| 2 min | ~10–18 s |

The first request after start is slower (model load). whisper.cpp keeps it
resident afterward.

## Differences from the Linux/CUDA build

| Aspect | Linux/WSL2 (CUDA) | macOS (Metal) |
|---|---|---|
| Whisper backend | speaches + faster-whisper, needs cuDNN lib-path fix | whisper.cpp, Metal built-in — no lib wrangling |
| GPU acceleration | `/dev/dxg` + injected CUDA libs | native Metal — just works |
| Shell rc | `~/.bashrc` | `~/.zshrc` |
| Shim OOM guard | `oom_score_adj` (Linux) | not needed |
| Shim code | identical | identical |
