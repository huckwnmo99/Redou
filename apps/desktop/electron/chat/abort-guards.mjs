export function createChatAbortError(message = "Chat pipeline aborted") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export function throwIfChatAborted(abortSignal) {
  if (abortSignal?.aborted) {
    throw createChatAbortError();
  }
}
