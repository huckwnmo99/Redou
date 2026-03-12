// Embedding Worker — generates vector embeddings using Transformers.js + all-MiniLM-L6-v2
// Runs in the Electron main process. Model is downloaded and cached on first use.

import path from "node:path";
import { app } from "electron";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;
const BATCH_SIZE = 32;

let pipelineInstance = null;
let initPromise = null;

function getModelCacheDir() {
  const documentsPath = app.getPath("documents");
  return path.join(documentsPath, "Redou", "Models");
}

async function loadPipeline() {
  const { pipeline, env } = await import("@xenova/transformers");
  env.cacheDir = getModelCacheDir();
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  const pipe = await pipeline("feature-extraction", MODEL_NAME, {
    quantized: true,
  });
  return pipe;
}

async function ensurePipeline() {
  if (pipelineInstance) {
    return pipelineInstance;
  }

  if (!initPromise) {
    initPromise = loadPipeline()
      .then((pipe) => {
        pipelineInstance = pipe;
        return pipe;
      })
      .catch((err) => {
        initPromise = null;
        throw err;
      });
  }

  return initPromise;
}

/**
 * Generate a single embedding for a text string.
 * Returns a Float32Array of length EMBEDDING_DIM.
 */
export async function generateEmbedding(text) {
  const pipe = await ensurePipeline();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return output.data;
}

/**
 * Generate embeddings for an array of texts in batches.
 * Returns an array of number[] (each of length EMBEDDING_DIM).
 * Calls onProgress(completed, total) after each batch.
 */
export async function generateEmbeddings(texts, onProgress) {
  const pipe = await ensurePipeline();
  const results = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchResults = [];

    for (const text of batch) {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      batchResults.push(Array.from(output.data));
    }

    results.push(...batchResults);

    if (onProgress) {
      onProgress(results.length, texts.length);
    }
  }

  return results;
}

export function isModelLoaded() {
  return pipelineInstance !== null;
}

export { MODEL_NAME, EMBEDDING_DIM };
