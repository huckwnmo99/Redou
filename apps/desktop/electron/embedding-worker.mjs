// Embedding Worker — generates vector embeddings via vLLM + nvidia/llama-nemotron-embed-vl-1b-v2
// Calls a local vLLM server (pooling runner) on port 8000.
// Vision-Language model: supports text, image, and image+text embeddings.
// Output dimension: 2048 (fixed).

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const MODEL_NAME = "nvidia/llama-nemotron-embed-vl-1b-v2";
const EMBEDDING_DIM = 2048;
const VLLM_BASE_URL = "http://localhost:8100";
const CONCURRENCY_LIMIT = 8;

/**
 * L2-normalize a vector.
 * @param {number[]} vec
 * @returns {number[]}
 */
function normalizeVector(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }
  return vec;
}

/**
 * Call vLLM embeddings endpoint with messages-based API (single request).
 * @param {{ role: string, content: Array<{type: string, [key: string]: any}> }} message
 * @returns {Promise<number[]>} — single embedding vector (2048-dim)
 */
async function callVllmSingle(message) {
  const body = {
    model: MODEL_NAME,
    messages: [message],
    encoding_format: "float",
  };

  const res = await fetch(`${VLLM_BASE_URL}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`vLLM embedding request failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return normalizeVector(json.data[0].embedding);
}

/**
 * Generate a single text embedding.
 * @param {string} text
 * @param {"query" | "document" | "passage"} type — "query" for search, "document"/"passage" for docs
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text, type = "document") {
  const role = type === "query" ? "query" : "document";
  return callVllmSingle({
    role,
    content: [{ type: "text", text }],
  });
}

/**
 * Generate embeddings for an array of texts with concurrency control.
 * Calls onProgress(completed, total) periodically.
 * @param {string[]} texts
 * @param {((done: number, total: number) => void) | undefined} onProgress
 * @param {"query" | "document" | "passage"} type
 * @returns {Promise<number[][]>}
 */
export async function generateEmbeddings(texts, onProgress, type = "document") {
  const role = type === "query" ? "query" : "document";
  const results = new Array(texts.length);
  let completed = 0;

  for (let i = 0; i < texts.length; i += CONCURRENCY_LIMIT) {
    const batch = texts.slice(i, i + CONCURRENCY_LIMIT);
    const promises = batch.map((text, j) =>
      callVllmSingle({
        role,
        content: [{ type: "text", text }],
      }).then((emb) => {
        results[i + j] = emb;
        completed++;
      })
    );
    await Promise.all(promises);

    if (onProgress) {
      onProgress(completed, texts.length);
    }
  }

  return results;
}

/**
 * Generate an embedding for an image file, optionally combined with caption text.
 * @param {string} imagePath — absolute path to PNG/JPG on disk
 * @param {string | null} captionText — optional caption to combine with image
 * @returns {Promise<number[]>}
 */
export async function generateImageEmbedding(imagePath, captionText = null) {
  const imageBuffer = await readFile(imagePath);
  const ext = extname(imagePath).toLowerCase();
  const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const content = [
    { type: "image_url", image_url: { url: dataUrl } },
  ];
  if (captionText && captionText.trim().length > 0) {
    content.push({ type: "text", text: captionText.trim() });
  }

  return callVllmSingle({ role: "document", content });
}

/**
 * Check if the vLLM server is reachable.
 */
export async function isModelLoaded() {
  try {
    const res = await fetch(`${VLLM_BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export { MODEL_NAME, EMBEDDING_DIM };
