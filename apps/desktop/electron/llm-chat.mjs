// LLM Chat Module — Ollama LLM (user-selectable) + Granite Guardian 3.3 8B
// Handles: streaming chat, JSON table generation, groundedness verification

/** Ollama fetch용 타임아웃 시그널. 기존 signal이 있으면 합성, 없으면 단독 사용. */
function ollamaSignal(existingSignal, timeoutMs = 300_000) {
  const timeoutSig = AbortSignal.timeout(timeoutMs);
  if (existingSignal) return AbortSignal.any([existingSignal, timeoutSig]);
  return timeoutSig;
}

const OLLAMA_BASE_URL = process.env.OLLAMA_HOST || "http://localhost:11434";
const DEFAULT_MODEL = process.env.REDOU_LLM_MODEL || "gpt-oss:120b";
const GUARDIAN_MODEL = process.env.REDOU_GUARDIAN_MODEL || "granite3-guardian:8b";
const LLM_CTX = parseInt(process.env.REDOU_LLM_CTX, 10) || 131072;

// --- Active model (mutable, runtime-changeable) ---
let _activeModel = DEFAULT_MODEL;

/** Get the currently active LLM model name. */
export function getActiveModel() {
  return _activeModel;
}

/** Set the active LLM model. Pass null/undefined to revert to default. */
export function setActiveModel(model) {
  _activeModel = model || DEFAULT_MODEL;
}

// ============================================================
// Streaming chat (clarification phase)
// ============================================================

/**
 * Stream a chat response from Ollama (NDJSON).
 * Yields token strings as they arrive.
 * @param {Array<{role: string, content: string}>} messages
 * @param {AbortSignal} [abortSignal]
 * @returns {AsyncGenerator<string>}
 */
export async function* streamChat(messages, abortSignal) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getActiveModel(),
      messages,
      stream: true,
      options: { num_ctx: LLM_CTX, temperature: 0.3 },
    }),
    signal: ollamaSignal(abortSignal),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama streaming error (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // preserve incomplete line
    for (const line of lines) {
      if (!line.trim()) continue;
      const json = JSON.parse(line);
      if (json.message?.content) yield json.message.content;
      if (json.done) return;
    }
  }
}

// ============================================================
// Granite Guardian — Groundedness verification
// ============================================================

/**
 * Check if a claim is grounded in the source text using granite3-guardian.
 *
 * Uses standard Ollama /api/chat protocol:
 * - role "system": groundedness check instructions
 * - role "user": context + claim in structured format
 * - Response: "Yes" = ungrounded, "No" = grounded (verified)
 */
export async function checkGroundedness(sourceText, claim) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GUARDIAN_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a groundedness-checking assistant. Given a Context and a Claim, determine whether the Claim is fully supported by the Context. Answer only \"Yes\" if the claim is NOT grounded (ungrounded/unsupported), or \"No\" if the claim IS grounded (supported by the context). Do not explain.",
        },
        {
          role: "user",
          content: `Context:\n${sourceText}\n\nClaim: ${claim}`,
        },
      ],
      stream: false,
      options: { temperature: 0, num_ctx: 16384 },
    }),
    signal: ollamaSignal(null),
  });

  if (!res.ok) {
    return { status: "unverified", evidence: `Guardian error: ${res.status}` };
  }

  const json = await res.json();
  const answer = json.message.content.trim().toLowerCase();
  // "No" = grounded = verified
  // "Yes" = ungrounded = unverified
  const isGrounded = answer.startsWith("no");
  return {
    status: isGrounded ? "verified" : "unverified",
    evidence: json.message.content.trim(),
  };
}

// ============================================================
// Health checks
// ============================================================

/**
 * Check if the currently selected LLM model is available in Ollama.
 */
export async function isLlmAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: ollamaSignal(null, 10_000),
    });
    if (!res.ok) return false;
    const json = await res.json();
    const active = getActiveModel();
    // Match by base name (before the colon tag) for flexibility
    const baseName = active.split(":")[0];
    return json.models?.some((m) => m.name.startsWith(baseName)) ?? false;
  } catch {
    return false;
  }
}

/**
 * Check if Granite Guardian is available in Ollama.
 */
export async function isGuardianAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: ollamaSignal(null, 10_000),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return (
      json.models?.some((m) => m.name.includes("granite3-guardian")) ?? false
    );
  } catch {
    return false;
  }
}

export {
  OLLAMA_BASE_URL,
  DEFAULT_MODEL,
  GUARDIAN_MODEL,
  ollamaSignal,
};
