import { IPC_EVENTS } from "../types/ipc-channels.mjs";

export function createChatStatusPayload(conversationId, status) {
  return {
    conversationId,
    ...status,
  };
}

export function createChatStatusEmitter({ conversationId, send }) {
  return (status) => {
    send(IPC_EVENTS.CHAT_STATUS, createChatStatusPayload(conversationId, status));
  };
}
