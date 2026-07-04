# Wiring Kimaki to the shim

Kimaki picks its transcription provider from environment variables. Setting the
two vars below makes Kimaki route Discord voice notes through **this shim**
instead of the paid Gemini/OpenAI cloud transcription.

## The two env vars

```bash
export OPENAI_API_KEY=local-shim                  # any value; selects the "openai" provider
export OPENAI_BASE_URL=http://localhost:7070/v1   # routes chat-completions to the shim
```

- `OPENAI_API_KEY` — Kimaki auto-selects the OpenAI transcription path when a key
  starting with anything non-Gemini is present. The value is **not** validated by
  the shim unless you set `SHIM_API_KEY` in `.env`. `local-shim` is fine.
- `OPENAI_BASE_URL` — points Kimaki's OpenAI client at the shim. Must end in `/v1`.

> **How it works:** Kimaki transcribes voice notes by sending an OpenAI
> **chat completion** containing a text prompt + an audio file part, forcing a
> `transcriptionResult` tool call (see Kimaki's `voice.ts`). The shim answers
> that exact request shape, so **no Kimaki patching is required** — just point
> the base URL at the shim.

## Clear any stored cloud key first (important)

If Kimaki has a stored Gemini/OpenAI transcription key in its DB, that key can
**override** the env vars. Clear it once:

```bash
python3 - <<'EOF'
import os, sqlite3
db = sqlite3.connect(os.path.expanduser("~/.kimaki/discord-sessions.db"))
cur = db.cursor()
try:
    cur.execute("UPDATE bot_api_keys SET gemini_api_key=NULL, openai_api_key=NULL")
    db.commit()
    print("cleared stored transcription keys")
except Exception as e:
    print("no bot_api_keys table or already clear:", e)
EOF
```

## Making the env vars stick (optional, durable)

Shell exports are lost when Kimaki starts from a different terminal. Two robust
options:

**A. Add to your shell rc** (covers fresh terminals):

```bash
# ~/.bashrc (Linux/WSL) or ~/.zshrc (macOS)
export OPENAI_API_KEY=local-shim
export OPENAI_BASE_URL=http://localhost:7070/v1
```

**B. Patch Kimaki's entry point** (covers every launch path — most durable).
Find `bin.js` and add two lines before the import:

```bash
ls -la ~/.npm/_npx/*/node_modules/kimaki/bin.js 2>/dev/null \
  || find ~ -path '*kimaki/bin.js' 2>/dev/null | head -1
```

```js
#!/usr/bin/env node
// Kimaki -> local Whisper shim (voice-note transcription)
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'local-shim'
process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'http://localhost:7070/v1'
import './dist/bin.js'
```

> A Kimaki package update can overwrite `bin.js`. If voice transcription breaks
> after upgrading Kimaki, re-apply this 2-line patch.

## Restart & verify

Stop Kimaki (Ctrl+C), open a fresh terminal so the env applies, and start it
again. Send a Discord voice note; watch the shim log:

```
[info] Transcribed N bytes -> "your actual words..."
```

That line proves the audio routed through your local Whisper GPU, not the cloud.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `requires an API key` in Discord | stored cloud key overrides env | run the DB-clear above, restart Kimaki |
| voice note fails, `ECONNREFUSED 7070` | shim not running | start the shim (`./scripts/run-shim.sh`) |
| `ECONNREFUSED 8000` or Whisper error | backend not running | start speaches / whisper.cpp |
| transcription still hits the cloud | env not applied to Kimaki's process | use rc export or the `bin.js` patch, restart |
