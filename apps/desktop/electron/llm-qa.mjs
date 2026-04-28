// LLM Q&A Module — Paper Q&A service (reuses streamChat from llm-chat.mjs)
// Handles: Q&A system prompt, RAG-augmented response generation, source attribution

import { streamChat, checkGroundedness } from "./llm-chat.mjs";

// ============================================================
// Q&A System Prompt
// ============================================================

const QA_SYSTEM_PROMPT = `You are Redou, a research paper assistant. Your role is to answer questions about academic papers using the provided context from the user's paper library.

## Rules
1. **Answer ONLY based on the provided context.** Do not use outside knowledge. If the context does not contain enough information, say so explicitly.
2. **Cite sources** using bracketed reference numbers like [1], [2] that correspond to the papers in the context. Place citations immediately after the relevant claim.
3. **Use markdown formatting** for readability: headers, bullet points, bold for key terms.
4. **Be concise but thorough.** Provide specific data, numbers, and findings from the papers when available.
5. **If comparing multiple papers**, organize the response clearly (e.g., by paper or by topic).
6. **Language**: Respond in the same language as the user's question. If Korean, respond in Korean. If English, respond in English.

## Response Format
- Start with a direct answer to the question
- Support with evidence from the context, citing sources [1], [2], etc.
- End with a brief summary if the answer is long
- Always include source attributions at the end:

---
**출처 / Sources:**
[1] Paper Title (Author, Year)
[2] Paper Title (Author, Year)
`;

// ============================================================
// Q&A Response Generation
// ============================================================

/**
 * Build the messages array for Q&A mode.
 * @param {string} ragContext - Assembled RAG context string
 * @param {Array<{role: string, content: string}>} history - Conversation history
 * @param {Array<{paperId: string, title: string, authors: string, year: number}>} paperMetadata
 * @returns {Array<{role: string, content: string}>}
 */
function buildQaMessages(ragContext, history, paperMetadata) {
  // Build paper reference list for the system prompt
  const refList = paperMetadata
    .map((p, i) => `[${i + 1}] ${p.title} (${p.authors || "Unknown"}, ${p.year || "N/A"})`)
    .join("\n");

  const contextMessage = `## Available Paper Context

### Paper References
${refList}

### Retrieved Content
${ragContext}`;

  return [
    { role: "system", content: QA_SYSTEM_PROMPT },
    { role: "system", content: contextMessage },
    ...history,
  ];
}

/**
 * Generate a Q&A response using RAG context and streaming.
 * Yields tokens as they arrive from the LLM.
 * @param {string} ragContext - Assembled RAG context string
 * @param {Array<{role: string, content: string}>} history - Conversation history
 * @param {Array<{paperId: string, title: string, authors: string, year: number}>} paperMetadata
 * @param {AbortSignal} [abortSignal]
 * @returns {AsyncGenerator<string>}
 */
export async function* generateQaResponse(ragContext, history, paperMetadata, abortSignal) {
  const messages = buildQaMessages(ragContext, history, paperMetadata);
  yield* streamChat(messages, abortSignal);
}

// ============================================================
// Source Attribution
// ============================================================

/**
 * Format source attribution for the response.
 * Ensures [1], [2], ... references in the text map to actual papers.
 * @param {string} responseText - The LLM-generated response text
 * @param {Array<{paperId: string, title: string, authors: string, year: number}>} paperMetadata
 * @returns {{ text: string, referencedPaperIds: string[] }}
 */
export function formatSourceAttribution(responseText, paperMetadata) {
  // Extract all [N] references from the text
  const refPattern = /\[(\d+)\]/g;
  const referencedIndices = new Set();
  let match;
  while ((match = refPattern.exec(responseText)) !== null) {
    const idx = parseInt(match[1], 10) - 1; // 0-based
    if (idx >= 0 && idx < paperMetadata.length) {
      referencedIndices.add(idx);
    }
  }

  // Collect referenced paper IDs
  const referencedPaperIds = [...referencedIndices]
    .sort((a, b) => a - b)
    .map((i) => paperMetadata[i].paperId);

  // If the response doesn't already contain a sources section, append one
  let text = responseText;
  if (!text.includes("출처") && !text.includes("Sources") && referencedIndices.size > 0) {
    const sourceLines = [...referencedIndices]
      .sort((a, b) => a - b)
      .map((i) => {
        const p = paperMetadata[i];
        return `[${i + 1}] ${p.title} (${p.authors || "Unknown"}, ${p.year || "N/A"})`;
      });
    text += `\n\n---\n**출처 / Sources:**\n${sourceLines.join("\n")}`;
  }

  return { text, referencedPaperIds };
}

export { QA_SYSTEM_PROMPT, checkGroundedness };
