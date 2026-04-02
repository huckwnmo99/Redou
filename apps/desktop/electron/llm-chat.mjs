// LLM Chat Module — Ollama gpt-oss:120b + Granite Guardian 3.3 8B
// Handles: streaming chat, JSON table generation, groundedness verification

const OLLAMA_BASE_URL = process.env.OLLAMA_HOST || "http://localhost:11434";
const LLM_MODEL = process.env.REDOU_LLM_MODEL || "gpt-oss:120b";
const GUARDIAN_MODEL = process.env.REDOU_GUARDIAN_MODEL || "granite3-guardian:8b";
const LLM_CTX = parseInt(process.env.REDOU_LLM_CTX, 10) || 131072;

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
      model: LLM_MODEL,
      messages,
      stream: true,
      options: { num_ctx: LLM_CTX, temperature: 0.3 },
    }),
    signal: abortSignal,
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
 * granite3-guardian uses a special protocol:
 * - system: "groundedness" activates groundedness-checking mode
 * - role "context": the source text
 * - role "assistant": the claim to verify
 * - Response: "Yes" = ungrounded (harmful), "No" = grounded (safe/verified)
 */
export async function checkGroundedness(sourceText, claim) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GUARDIAN_MODEL,
      system: "groundedness",
      messages: [
        { role: "context", content: sourceText },
        { role: "assistant", content: claim },
      ],
      stream: false,
      options: { temperature: 0, num_ctx: 16384 },
    }),
  });

  if (!res.ok) {
    return { status: "unverified", evidence: `Guardian error: ${res.status}` };
  }

  const json = await res.json();
  const answer = json.message.content.trim().toLowerCase();
  // "No" = not harmful = grounded = verified
  // "Yes" = harmful = ungrounded = unverified
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
 * Check if the LLM (gpt-oss:120b) is available in Ollama.
 */
export async function isLlmAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json.models?.some((m) => m.name.startsWith("gpt-oss")) ?? false;
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
      signal: AbortSignal.timeout(3000),
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
  LLM_MODEL,
  GUARDIAN_MODEL,
};
