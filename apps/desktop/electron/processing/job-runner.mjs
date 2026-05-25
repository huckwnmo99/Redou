function getErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function summarizeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    paperId: job.paper_id ?? null,
    jobType: job.job_type ?? null,
  };
}

export async function runQueuedProcessingJob({
  loadNextJob,
  updateJobStatus,
  processJob,
  broadcastJobFailed = () => {},
  now = () => new Date().toISOString(),
}) {
  if (typeof loadNextJob !== "function") {
    throw new TypeError("runQueuedProcessingJob requires loadNextJob");
  }
  if (typeof updateJobStatus !== "function") {
    throw new TypeError("runQueuedProcessingJob requires updateJobStatus");
  }
  if (typeof processJob !== "function") {
    throw new TypeError("runQueuedProcessingJob requires processJob");
  }

  const job = await loadNextJob();
  if (!job) {
    return { job: null, status: "idle" };
  }

  const summary = summarizeJob(job);

  try {
    if (!job.id) {
      throw new Error("Queued job is missing an id.");
    }
    if (!job.paper_id) {
      throw new Error("Queued job is missing a paper_id.");
    }

    await updateJobStatus(job.id, {
      status: "running",
      started_at: now(),
      error_message: null,
    });

    await processJob(job);
    return { job: summary, status: "processed" };
  } catch (err) {
    const message = getErrorMessage(err);
    if (job.id) {
      try {
        await updateJobStatus(job.id, {
          status: "failed",
          finished_at: now(),
          error_message: message,
        });
      } catch {
        // Best effort: the caller still needs the failure event/result.
      }
      broadcastJobFailed({
        jobId: job.id,
        paperId: job.paper_id ?? null,
        error: message,
      });
    }
    return {
      job: summary,
      status: "failed",
      error: message,
    };
  }
}
