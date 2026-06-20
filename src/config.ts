// Configuration for the Kimaki Whisper shim.
// All values come from env (Bun auto-loads .env). Sensible defaults for the
// "speaches on Windows GPU + shim in WSL" setup.

export const config = {
  // Port the shim listens on (Kimaki points OPENAI_BASE_URL here).
  port: Number(process.env.SHIM_PORT ?? 7070),

  // Whisper backend: an OpenAI-compatible /v1/audio/transcriptions endpoint.
  // speaches default port is 8000. On Windows host reachable from WSL via its LAN IP.
  // Example: http://192.168.1.140:8000/v1  (or http://<windows-host-ip>:8000/v1)
  whisperBaseURL: process.env.WHISPER_BASE_URL ?? "http://localhost:8000/v1",

  // Model id the Whisper backend should use. speaches uses HF ids.
  whisperModel:
    process.env.WHISPER_MODEL ?? "Systran/faster-whisper-large-v3",

  // Optional API key for the Whisper backend (speaches usually needs none).
  whisperApiKey: process.env.WHISPER_API_KEY ?? "none",

  // Optional shared secret: if set, the shim requires this as the bearer token
  // (i.e. Kimaki's OPENAI_API_KEY must equal this). Empty = accept anything.
  expectedApiKey: process.env.SHIM_API_KEY ?? "",

  // Language hint forwarded to Whisper ("" = autodetect).
  language: process.env.WHISPER_LANGUAGE ?? "",

  logLevel: (process.env.SHIM_LOG_LEVEL ?? "info") as "debug" | "info" | "error",
};

export function log(level: "debug" | "info" | "error", ...args: unknown[]) {
  const order = { debug: 0, info: 1, error: 2 };
  if (order[level] >= order[config.logLevel]) {
    const ts = new Date().toISOString();
    console[level === "debug" ? "log" : level](`[${ts}] [${level}]`, ...args);
  }
}
