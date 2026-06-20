// Rule-based post-processing of the raw Whisper transcript.
// Mirrors the behaviour Kimaki asks the transcription LLM to perform via the
// transcriptionResult tool schema: queue detection + explicit agent selection.
// No LLM needed — simple, deterministic string matching we can maintain.

export interface TranscriptionResult {
  transcription: string;
  queueMessage?: boolean;
  agent?: string;
}

const QUEUE_PHRASES = [
  "queue this message",
  "queue this",
  "add this to the queue",
  "add to the queue",
  "queue it",
];

// Matches "use the X agent", "switch to X agent", "with the X agent".
// Captures the agent name token(s) between the verb and the word "agent".
const AGENT_REGEX =
  /\b(?:use the|switch to|with the|using the)\s+([a-z0-9][a-z0-9 _-]*?)\s+agent\b/i;

function stripLeadingPunctuation(s: string): string {
  return s.replace(/^[\s.,;:!?-]+/, "").trim();
}

export function postProcess(
  rawText: string,
  agentNames: string[] = [],
): TranscriptionResult {
  let text = (rawText ?? "").trim();

  if (!text) {
    return { transcription: "[inaudible audio]" };
  }

  const result: TranscriptionResult = { transcription: text };

  // --- Queue detection ---
  const lower = text.toLowerCase();
  for (const phrase of QUEUE_PHRASES) {
    const idx = lower.indexOf(phrase);
    if (idx !== -1) {
      result.queueMessage = true;
      // Remove the queue phrase from the transcription.
      const before = text.slice(0, idx);
      const after = text.slice(idx + phrase.length);
      const stripped = stripLeadingPunctuation((before + after).trim());
      // If removing it would empty the message, keep the original text.
      result.transcription = stripped.length > 0 ? stripped : text;
      break;
    }
  }

  // --- Agent selection (only if Kimaki provided agent names) ---
  if (agentNames.length > 0) {
    const m = result.transcription.match(AGENT_REGEX);
    if (m) {
      const spoken = m[1].trim().toLowerCase();
      // Match spoken name against known agents (case-insensitive, loose).
      const matched = agentNames.find(
        (a) =>
          a.toLowerCase() === spoken ||
          a.toLowerCase().replace(/[-_]/g, " ") === spoken,
      );
      if (matched) {
        result.agent = matched;
        // Remove the agent instruction from the transcription.
        result.transcription = stripLeadingPunctuation(
          result.transcription.replace(AGENT_REGEX, "").replace(/\s{2,}/g, " ").trim(),
        );
        if (!result.transcription) {
          // Don't return empty — restore original sans-agent fallback.
          result.transcription = text;
        }
      }
    }
  }

  if (!result.transcription.trim()) {
    result.transcription = "[inaudible audio]";
  }

  return result;
}

// Extract the list of agent enum values Kimaki put in the transcriptionResult
// tool schema, so post-processing knows the valid agent names.
export function extractAgentNames(tools: unknown): string[] {
  try {
    if (!Array.isArray(tools)) return [];
    for (const tool of tools as any[]) {
      const fn = tool?.function ?? tool;
      if (fn?.name === "transcriptionResult") {
        const enumVals = fn?.parameters?.properties?.agent?.enum;
        if (Array.isArray(enumVals)) return enumVals.filter((v) => typeof v === "string");
      }
    }
  } catch {
    // ignore
  }
  return [];
}
