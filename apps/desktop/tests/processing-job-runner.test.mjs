import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runQueuedProcessingJob } from "../electron/processing/job-runner.mjs";

describe("processing job runner", () => {
  it("marks an active worker job failed when processing throws", async () => {
    const updates = [];
    const failures = [];
    let tick = 0;

    const result = await runQueuedProcessingJob({
      loadNextJob: async () => ({
        id: "job-1",
        paper_id: "paper-1",
        job_type: "generate_embeddings",
      }),
      updateJobStatus: async (jobId, patch) => {
        updates.push({ jobId, patch });
      },
      processJob: async () => {
        throw new Error("embedding worker failed");
      },
      broadcastJobFailed: (payload) => {
        failures.push(payload);
      },
      now: () => `2026-05-25T00:00:0${tick++}.000Z`,
    });

    assert.deepEqual(result, {
      job: {
        id: "job-1",
        paperId: "paper-1",
        jobType: "generate_embeddings",
      },
      status: "failed",
      error: "embedding worker failed",
    });
    assert.deepEqual(updates, [
      {
        jobId: "job-1",
        patch: {
          status: "running",
          started_at: "2026-05-25T00:00:00.000Z",
          error_message: null,
        },
      },
      {
        jobId: "job-1",
        patch: {
          status: "failed",
          finished_at: "2026-05-25T00:00:01.000Z",
          error_message: "embedding worker failed",
        },
      },
    ]);
    assert.deepEqual(failures, [
      {
        jobId: "job-1",
        paperId: "paper-1",
        error: "embedding worker failed",
      },
    ]);
  });
});
