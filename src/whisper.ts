// Client for an OpenAI-compatible Whisper backend (speaches / faster-whisper-server).
// Sends audio to /v1/audio/transcriptions and returns the raw transcript text.

import { config, log } from "./config.ts";

export interface WhisperInput {
  audio: Uint8Array;
  mediaType: string; // e.g. "audio/ogg", "audio/wav", "audio/mpeg"
}

function extFromMediaType(mediaType: string): string {
  const map: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/webm": "webm",
    "audio/flac": "flac",
  };
  return map[mediaType.toLowerCase()] ?? "ogg";
}

export async function transcribeWithWhisper(input: WhisperInput): Promise<string> {
  const ext = extFromMediaType(input.mediaType);
  const filename = `voice.${ext}`;

  const form = new FormData();
  // Bun supports Blob/File in FormData natively.
  const blob = new Blob([input.audio], { type: input.mediaType });
  form.append("file", blob, filename);
  form.append("model", config.whisperModel);
  form.append("response_format", "json");
  if (config.language) {
    form.append("language", config.language);
  }

  const url = `${config.whisperBaseURL.replace(/\/$/, "")}/audio/transcriptions`;
  log("debug", `POST ${url} model=${config.whisperModel} bytes=${input.audio.length} type=${input.mediaType}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whisperApiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Whisper backend ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { text?: string };
  // whisper.cpp emits a newline after each audio segment (at natural speech
  // pauses), which renders as awkward multi-line text in Discord. Collapse all
  // internal whitespace/newlines into single spaces so the transcript reads as
  // one flowing paragraph (matching the cloud/faster-whisper backends).
  return (data.text ?? "").replace(/\s+/g, " ").trim();
}
