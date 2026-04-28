// Reranker Worker — cross-encoder re-scoring for RAG chunks
// Uses @xenova/transformers (v2) with ONNX Runtime for CPU inference.
// Model: Xenova/bge-reranker-base (XLM-RoBERTa, multilingual, 278M params)
// API: AutoTokenizer + AutoModelForSequenceClassification (not pipeline)

import { AutoTokenizer, AutoModelForSequenceClassification, env } from "@xenova/transformers";

// Use remote models from HuggingFace Hub
env.allowLocalModels = false;

const RERANKER_MODEL = "Xenova/bge-reranker-base";

let _tokenizer = null;
let _model = null;
let _loadPromise = null;
let _loadFailed = false;

/**
 * Load the reranker model (singleton, lazy).
 * First call downloads ONNX weights (~350MB quantized) from HuggingFace Hub.
 * Subsequent calls return the cached model immediately.
 */
export async function initReranker() {
  if (_model && _tokenizer) return { tokenizer: _tokenizer, model: _model };
  if (_loadFailed) return null;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    try {
      console.log(`[reranker] Loading model: ${RERANKER_MODEL}...`);
      const start = Date.now();

      // Load tokenizer and model in parallel
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(RERANKER_MODEL),
        AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, {
          quantized: true, // INT8 ONNX for smaller download & faster inference
        }),
      ]);

      _tokenizer = tokenizer;
      _model = model;

      console.log(`[reranker] Model loaded in ${Date.now() - start}ms`);
      return { tokenizer: _tokenizer, model: _model };
    } catch (err) {
      console.error(`[reranker] Failed to load model:`, err.message);
      _loadFailed = true;
      return null;
    } finally {
      _loadPromise = null;
    }
  })();

  return _loadPromise;
}

/**
 * Check if the reranker model is available (loaded or loadable).
 * Triggers lazy loading if not yet attempted.
 */
export async function isRerankerAvailable() {
  if (_model && _tokenizer) return true;
  if (_loadFailed) return false;
  const result = await initReranker();
  return result !== null;
}

/**
 * Rerank chunks by cross-encoder relevance scoring.
 *
 * Scores each (query, chunk.text) pair using the cross-encoder model.
 * Returns the top-K chunks sorted by relevance score (descending).
 *
 * For bge-reranker, the model takes tokenized (query, passage) pairs and
 * outputs raw logits — higher values indicate greater relevance.
 *
 * @param {string} query — the user's search query
 * @param {Array<{text?: string, content?: string, [key: string]: any}>} chunks — RAG chunks
 * @param {number} topK — how many top chunks to return
 * @returns {Promise<Array>} — top-K chunks with _rerankerScore attached
 */
export async function rerankChunks(query, chunks, topK = 15) {
  const loaded = _model && _tokenizer ? { tokenizer: _tokenizer, model: _model } : await initReranker();
  if (!loaded || chunks.length === 0) return chunks.slice(0, topK);

  const { tokenizer, model } = loaded;

  // Build parallel arrays for batch tokenization: queries[] and passages[]
  const queries = [];
  const passages = [];
  const validIndices = [];

  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i].text || chunks[i].content || "";
    if (text.trim().length === 0) continue;
    queries.push(query);
    passages.push(text);
    validIndices.push(i);
  }

  if (queries.length === 0) return chunks.slice(0, topK);

  // Score in batches to manage memory (batch size 8)
  const BATCH_SIZE = 8;
  const scores = new Array(chunks.length).fill(-Infinity);

  for (let batchStart = 0; batchStart < queries.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, queries.length);
    const batchQueries = queries.slice(batchStart, batchEnd);
    const batchPassages = passages.slice(batchStart, batchEnd);
    const batchIndices = validIndices.slice(batchStart, batchEnd);

    try {
      // Tokenize (query, passage) pairs
      const inputs = tokenizer(batchQueries, {
        text_pair: batchPassages,
        padding: true,
        truncation: true,
      });

      // Forward pass — returns { logits: Tensor }
      const output = await model(inputs);

      // Extract scores from logits
      // For cross-encoder rerankers, logits is a [batch, 1] tensor (raw relevance score)
      const logits = output.logits.data; // Float32Array

      for (let j = 0; j < batchIndices.length; j++) {
        scores[batchIndices[j]] = logits[j];
      }
    } catch (err) {
      console.warn(`[reranker] Batch scoring failed (batch ${batchStart}-${batchEnd}):`, err.message);
      // Leave these chunks with -Infinity score (lowest priority)
    }
  }

  // Build scored chunks, attach _rerankerScore, sort descending
  const scored = chunks.map((chunk, idx) => ({
    ...chunk,
    _rerankerScore: scores[idx],
  }));

  scored.sort((a, b) => b._rerankerScore - a._rerankerScore);

  return scored.slice(0, topK);
}
