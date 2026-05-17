import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { throwIfChatAborted } from "../electron/chat/abort-guards.mjs";
import { createChatStatusEmitter, createChatStatusPayload } from "../electron/chat/status-events.mjs";
import { IPC_CHANNELS, IPC_EVENTS } from "../electron/types/ipc-channels.mjs";

describe("desktop IPC test harness", () => {
  it("loads shared chat channel definitions without Electron", () => {
    assert.equal(IPC_CHANNELS.CHAT_SEND_MESSAGE, "chat:send-message");
    assert.equal(IPC_CHANNELS.CHAT_ABORT, "chat:abort");
    assert.equal(IPC_EVENTS.CHAT_STATUS, "chat:status");
  });

  it("emits chat status payloads with the conversation id and nullable stage", () => {
    const payload = createChatStatusPayload("conversation-1", {
      stage: null,
      message: "",
      detail: "clarify",
    });

    assert.deepEqual(payload, {
      conversationId: "conversation-1",
      stage: null,
      message: "",
      detail: "clarify",
    });

    const sent = [];
    const emitStatus = createChatStatusEmitter({
      conversationId: "conversation-1",
      send: (eventName, eventPayload) => sent.push({ eventName, eventPayload }),
    });

    emitStatus({ stage: "searching", message: "Searching", detail: "2 queries" });

    assert.deepEqual(sent, [{
      eventName: IPC_EVENTS.CHAT_STATUS,
      eventPayload: {
        conversationId: "conversation-1",
        stage: "searching",
        message: "Searching",
        detail: "2 queries",
      },
    }]);
  });

  it("throws AbortError when a chat abort signal is already aborted", () => {
    const controller = new AbortController();

    assert.doesNotThrow(() => throwIfChatAborted(controller.signal));

    controller.abort();

    assert.throws(
      () => throwIfChatAborted(controller.signal),
      (err) => err?.name === "AbortError" && err?.message === "Chat pipeline aborted",
    );
  });
});
