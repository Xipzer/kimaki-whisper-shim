# Connect Kimaki / OpenCode to a local LLM (llama.cpp server)

A companion to the voice-transcription shim: this wires a **local LLM served by
llama.cpp** (or any OpenAI-compatible server) into Kimaki as a selectable model
via the Discord `/model` command. Independent of the shim — use either or both.

Follow the steps in order; the verification steps catch non-obvious gotchas.

## 0. Prerequisites

- Local LLM served by `llama-server` (llama.cpp) or any OpenAI-compatible endpoint
  exposing `/v1/models` and `/v1/chat/completions`.
- Server started with `--host 0.0.0.0` so it's reachable over the network.
- OpenCode installed (`opencode --version`); Kimaki runs on top of it.
- You know the **IP + port** of the LLM host.

> **Critical:** `localhost:8080` is only localhost *from the LLM box*. If Kimaki
> runs on a different machine, use the LLM host's **LAN IP**
> (e.g. `http://<llm-host-ip>:8080/v1`), never `localhost`.

## 1. Determine the base URL

From the machine where Kimaki/OpenCode runs:

```bash
curl -s -m 6 http://<LLM_IP>:<PORT>/v1/models
```

Record two values from the JSON: the exact model **`id`** (usually the GGUF
filename) and `meta.n_ctx` (loaded context window). If `curl` fails, confirm
`--host 0.0.0.0`, firewall, and network before proceeding.

## 2. Locate the OpenCode config

Global config: `~/.config/opencode/opencode.json`. Read it first and **preserve
all existing keys** — you are ADDING a `provider` block, not replacing the file.

## 3. Add the local provider

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "llama-local": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "<FRIENDLY_NAME>",
      "options": {
        "baseURL": "http://<LLM_IP>:<PORT>/v1",
        "apiKey": "local-no-auth"
      },
      "models": {
        "<MODEL_ID>": {
          "name": "<FRIENDLY_NAME>",
          "tools": true,
          "reasoning": false,
          "options": { "temperature": 0.6, "top_p": 0.95 }
        }
      }
    }
  }
}
```

| Field | Why it matters |
|---|---|
| `"npm": "@ai-sdk/openai-compatible"` | Uses the OpenAI-compatible adapter. |
| `"apiKey": "local-no-auth"` | **Critical.** Kimaki's `/model` picker only lists providers with *some* credential. Without a dummy key the provider won't appear. llama-server ignores the value. |
| `baseURL` ending in `/v1` | OpenAI-compatible route prefix. |
| `"tools": true` | Enables tool/function-calling (bash/read/write). Required for agentic use. |
| `"reasoning": false` | Most local GGUFs expose no reasoning channel; leaving it on can break parsing. |
| model key = `<MODEL_ID>` | Must match `/v1/models` `id` exactly or requests 404. |

## 4. Verify OpenCode sees the model

```bash
opencode models 2>/dev/null | grep llama-local     # expect: llama-local/<MODEL_ID>
```

If nothing prints: re-check the `apiKey` is present (most common cause), and that
the JSON is valid (`jq . opencode.json`).

## 5. Verify the tool loop works

Listing a model doesn't prove it can drive tools. Test headlessly:

```bash
mkdir -p /tmp/llm-toolcheck && cd /tmp/llm-toolcheck
opencode run --model "llama-local/<MODEL_ID>" \
  "Create a file called ok.txt containing 'tools work', then read it back."
cat /tmp/llm-toolcheck/ok.txt      # expect: tools work
```

If the model writes prose but no file appears, it isn't reliably driving tools.

## 6. Select it in Discord

In any Kimaki thread: `/model` → pick provider `<FRIENDLY_NAME>` → pick the model
→ choose scope (session / channel / global). If it doesn't appear, restart Kimaki
so it re-reads the config (only with the user's approval).

## 7. Context window guidance

Local models have a fixed ceiling = the server's `-c` value. Exceeding it makes
llama.cpp reject the whole request. Mitigations: keep sessions short; disable
unused skills (`--disable-skill <name>`); or raise `-c` up to `n_ctx_train`
(costs more KV-cache VRAM).

## 8. Safety warnings

- Kimaki's **entire control plane** runs through the selected model — every tool
  call, file op, `kimaki send`, scheduling. A small local model degrades on long
  multi-step tool loops.
- The model has **full tool access** (bash, file read/write). An
  "uncensored"/"abliterated" model won't refuse anything — do NOT set it as
  **global default** if any channel touches sensitive repos (keys, trading bots).
- **Recommended:** keep a cloud model as global default; switch to the local
  model with **session scope** only, in a dedicated thread/directory.

## 9. Rollback

Delete the `"llama-local"` block from `~/.config/opencode/opencode.json` and
restart Kimaki. No other files are modified.
