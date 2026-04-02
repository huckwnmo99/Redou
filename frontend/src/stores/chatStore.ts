import { create } from "zustand";
import type { ChatPipelineStage } from "@/types/desktop";

interface ChatState {
  activeConversationId: string | null;
  streamingContent: string;
  streamingMessageId: string | null;
  isStreaming: boolean;
  scopeFolderId: string | null;
  scopeAll: boolean;

  // Pipeline stage tracking
  pipelineStage: ChatPipelineStage | null;
  pipelineMessage: string;
  pipelineDetail: string;

  setActiveConversationId: (id: string | null) => void;
  appendToken: (token: string) => void;
  startStreaming: (conversationId: string) => void;
  finishStreaming: (messageId?: string) => void;
  resetStreaming: () => void;
  setPipelineStage: (stage: ChatPipelineStage | null, message?: string, detail?: string) => void;
  clearPipeline: () => void;
  setScopeFolderId: (id: string | null) => void;
  setScopeAll: (all: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeConversationId: null,
  streamingContent: "",
  streamingMessageId: null,
  isStreaming: false,
  scopeFolderId: null,
  scopeAll: true,
  pipelineStage: null,
  pipelineMessage: "",
  pipelineDetail: "",

  setActiveConversationId: (id) => set({ activeConversationId: id }),

  appendToken: (token) =>
    set((state) => ({ streamingContent: state.streamingContent + token })),

  startStreaming: (conversationId) =>
    set({
      activeConversationId: conversationId,
      streamingContent: "",
      streamingMessageId: null,
      isStreaming: true,
      pipelineStage: null,
      pipelineMessage: "",
      pipelineDetail: "",
    }),

  finishStreaming: (messageId) =>
    set({
      isStreaming: false,
      streamingMessageId: messageId ?? null,
      streamingContent: "",
      pipelineStage: null,
      pipelineMessage: "",
      pipelineDetail: "",
    }),

  resetStreaming: () =>
    set({
      streamingContent: "",
      streamingMessageId: null,
      isStreaming: false,
      pipelineStage: null,
      pipelineMessage: "",
      pipelineDetail: "",
    }),

  setPipelineStage: (stage, message, detail) =>
    set({
      pipelineStage: stage,
      pipelineMessage: message ?? "",
      pipelineDetail: detail ?? "",
    }),

  clearPipeline: () =>
    set({ pipelineStage: null, pipelineMessage: "", pipelineDetail: "" }),

  setScopeFolderId: (id) => set({ scopeFolderId: id, scopeAll: id === null }),
  setScopeAll: (all) => set({ scopeAll: all, scopeFolderId: all ? null : null }),
}));
