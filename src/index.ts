// Kimaki Whisper Shim
// Impersonates OpenAI's /v1/chat/completions so Kimaki's voice-note transcription
// (which sends a text prompt + audio file part and forces a `transcriptionResult`
// tool call) is served by a LOCAL Whisper backend instead of OpenAI/Gemini.
//
// Flow:
//   Kimaki --(OPENAI_BASE_URL)--> this shim --(/v1/audio/transcriptions)--> speaches
//   speaches returns text --> shim wraps it as a transcriptionResult tool call
//
// Integration (no Kimaki patch):
//   OPENAI_API_KEY=<anything>             (so Kimaki selects the "openai" provider)
//   OPENAI_BASE_URL=http://localhost:7070/v1

import { config, log } from "./config.ts";
import { transcribeWithWhisper } from "./whisper.ts";
import { postProcess, extractAgentNames } from "./postprocess.ts";

interface ChatContentPart {
  type: string;
  text?: string;
  // AI SDK openai provider sends audio as an input_audio part on chat completions:
  input_audio?: { data: string; format?: string };
  // Some encoders use a generic file/audio_url shape — handle defensively.
  audio_url?: { url: string };
  file?: { data?: string; file_data?: string; media_type?: string; mediaType?: string };
}

interface ChatMessage {
  role: string;
  content: string | ChatContentPart[];
}

interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: unknown;
  tool_choice?: unknown;
  temperature?: number;
}

function b64ToBytes(b64: string): Uint8Array {
  // Strip data URL prefix if present.
  const clean = b64.includes(",") && b64.startsWith("data:") ? b64.split(",")[1] : b64;
  return Uint8Array.from(Buffer.from(clean, "base64"));
}

function formatToMediaType(format?: string): string {
  if (!format) return "audio/ogg";
  if (format.startsWith("audio/")) return format;
  const map: Record<string, string> = {
    ogg: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    mpeg: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    webm: "audio/webm",
    flac: "audio/flac",
  };
  return map[format.toLowerCase()] ?? "audio/ogg";
}

// Pull the first audio part out of the chat messages, regardless of which
// shape the AI SDK used (input_audio / file / audio_url data URL).
function extractAudio(
  messages: ChatMessage[],
): { bytes: Uint8Array; mediaType: string } | null {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.input_audio?.data) {
        return {
          bytes: b64ToBytes(part.input_audio.data),
          mediaType: formatToMediaType(part.input_audio.format),
        };
      }
      if (part.file?.data || part.file?.file_data) {
        const data = (part.file.data ?? part.file.file_data)!;
        const mt = part.file.media_type ?? part.file.mediaType ?? "audio/ogg";
        return { bytes: b64ToBytes(data), mediaType: mt };
      }
      if (part.audio_url?.url?.startsWith("data:")) {
        const url = part.audio_url.url;
        const mt = url.slice(5, url.indexOf(";")) || "audio/ogg";
        return { bytes: b64ToBytes(url), mediaType: mt };
      }
    }
  }
  return null;
}

function authOk(req: Request): boolean {
  if (!config.expectedApiKey) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${config.expectedApiKey}`;
}

// Build an OpenAI chat-completion response that contains a single forced
// tool call to `transcriptionResult` with our structured args.
function buildToolCallResponse(args: {
  transcription: string;
  queueMessage?: boolean;
  agent?: string;
}) {
  const argJson = JSON.stringify(args);
  return {
    id: `chatcmpl-shim-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "kimaki-whisper-shim",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_${Date.now()}`,
              type: "function",
              function: {
                name: "transcriptionResult",
                arguments: argJson,
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

async function handleChatCompletions(req: Request): Promise<Response> {
  if (!authOk(req)) {
    return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  let body: ChatCompletionRequest;
  try {
    body = (await req.json()) as ChatCompletionRequest;
  } catch {
    return Response.json({ error: { message: "Invalid JSON" } }, { status: 400 });
  }

  const audio = extractAudio(body.messages ?? []);
  if (!audio) {
    log("error", "No audio part found in request");
    return Response.json(
      { error: { message: "No audio content found in messages" } },
      { status: 400 },
    );
  }

  const agentNames = extractAgentNames(body.tools);

  try {
    const rawText = await transcribeWithWhisper({
      audio: audio.bytes,
      mediaType: audio.mediaType,
    });
    log("info", `Transcribed ${audio.bytes.length} bytes -> "${rawText.slice(0, 80)}"`);

    const result = postProcess(rawText, agentNames);
    log(
      "debug",
      `Post-processed: queue=${!!result.queueMessage} agent=${result.agent ?? "-"}`,
    );

    return Response.json(buildToolCallResponse(result));
  } catch (err) {
    log("error", "Transcription failed:", err);
    // Return a valid tool call with the inaudible marker so Kimaki degrades gracefully.
    return Response.json(
      buildToolCallResponse({ transcription: "[inaudible audio]" }),
    );
  }
}

const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, whisper: config.whisperBaseURL });
    }

    // The AI SDK calls /v1/chat/completions.
    if (url.pathname.endsWith("/chat/completions") && req.method === "POST") {
      return handleChatCompletions(req);
    }

    // Minimal /v1/models so any capability probe succeeds.
    if (url.pathname.endsWith("/models")) {
      return Response.json({
        object: "list",
        data: [{ id: "kimaki-whisper-shim", object: "model", owned_by: "local" }],
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

// Lower our OOM-killer priority so the kernel reaps other processes before this
// shim under memory pressure (the "Killed" SIGKILL we saw was the OOM reaper).
// Best-effort: silently ignored if not permitted.
try {
  await Bun.write(`/proc/${process.pid}/oom_score_adj`, "-500");
  log("debug", "Set oom_score_adj=-500 (OOM-protected)");
} catch {
  // not permitted — fine
}

log("info", `Kimaki Whisper shim listening on http://0.0.0.0:${server.port}`);
log("info", `Whisper backend: ${config.whisperBaseURL} (model: ${config.whisperModel})`);
log("info", `Point Kimaki at: OPENAI_BASE_URL=http://localhost:${server.port}/v1`);
