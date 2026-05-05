import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useChatStore } from "@/stores/chatStore";
import { supabase } from "./supabase";
import type {
  ChatConversation,
  ChatMessage,
  ChatGeneratedTable,
  ChatSendMessageParams,
} from "@/types/chat";
import type {
  ChatTokenEvent,
  ChatCompleteEvent,
  ChatVerificationDoneEvent,
  ChatErrorEvent,
  ChatStatusEvent,
  RedouDesktopApi,
  OllamaModel,
  LlmModelInfo,
} from "@/types/desktop";

// ============================================================
// Query Keys
// ============================================================

export const chatKeys = {
  conversations: ["chat-conversations"] as const,
  messages: (convId: string) => ["chat-messages", convId] as const,
  table: (tableId: string) => ["chat-table", tableId] as const,
};

export const llmKeys = {
  models: ["llm-models"] as const,
  activeModel: ["llm-active-model"] as const,
};

// ============================================================
// Helpers
// ============================================================

function getDesktopApi(): RedouDesktopApi | null {
  if (typeof window === "undefined") return null;
  return window.redouDesktop ?? null;
}

function requireDesktopApi(): RedouDesktopApi {
  const api = getDesktopApi();
  if (!api) throw new Error("Desktop actions are only available inside the Electron shell.");
  return api;
}

async function getAuthContext() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.user?.id || !session.access_token) {
    throw new Error(error?.message ?? "Your session is no longer available. Sign in again.");
  }

  return {
    userId: session.user.id,
    accessToken: session.access_token,
  };
}

// ============================================================
// Queries
// ============================================================

export function useChatConversations() {
  return useQuery({
    queryKey: chatKeys.conversations,
    queryFn: async (): Promise<ChatConversation[]> => {
      const { userId } = await getAuthContext();
      const { data, error } = await supabase
        .from("chat_conversations")
        .select("*")
        .eq("owner_user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ChatConversation[];
    },
  });
}

export function useChatMessages(conversationId: string | null) {
  return useQuery({
    queryKey: chatKeys.messages(conversationId ?? "none"),
    queryFn: async (): Promise<ChatMessage[]> => {
      if (!conversationId) return [];
      await getAuthContext();
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ChatMessage[];
    },
    enabled: Boolean(conversationId),
  });
}

export function useChatTable(tableId: string | null) {
  return useQuery({
    queryKey: chatKeys.table(tableId ?? "none"),
    queryFn: async (): Promise<ChatGeneratedTable | null> => {
      if (!tableId) return null;
      await getAuthContext();
      const { data, error } = await supabase
        .from("chat_generated_tables")
        .select("*")
        .eq("id", tableId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as ChatGeneratedTable | null;
    },
    enabled: Boolean(tableId),
  });
}

// ============================================================
// Mutations
// ============================================================

export function useSendChatMessage() {
  const queryClient = useQueryClient();
  const startStreaming = useChatStore((s) => s.startStreaming);

  return useMutation({
    mutationFn: async (params: ChatSendMessageParams) => {
      const api = requireDesktopApi();
      const authContext = await getAuthContext();
      // Start streaming BEFORE the IPC call (handler blocks until LLM finishes)
      const tempConvId = params.conversationId ?? "pending";
      startStreaming(tempConvId);
      // Show user message immediately (optimistic update)
      useChatStore.getState().setPendingUserMessage(params.message);

      // Include mode from chatStore if not explicitly provided
      const mode = params.mode ?? useChatStore.getState().conversationType;
      const result = await api.chat.sendMessage({ ...params, mode, ...authContext }) as unknown as {
        conversationId: string;
        messageId?: string;
        hasTable?: boolean;
        error?: string;
      };

      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (data) => {
      // Update conversation ID if it was newly created
      useChatStore.getState().setActiveConversationId(data.conversationId);
      useChatStore.getState().clearPendingUserMessage();
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      queryClient.invalidateQueries({ queryKey: chatKeys.messages(data.conversationId) });
    },
    onError: () => {
      useChatStore.getState().clearPendingUserMessage();
    },
  });
}

export function useAbortChat() {
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const api = requireDesktopApi();
      const authContext = await getAuthContext();
      await api.chat.abort({ conversationId, ...authContext });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  const { activeConversationId, setActiveConversationId } = useChatStore();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { userId } = await getAuthContext();
      const { error } = await supabase
        .from("chat_conversations")
        .delete()
        .eq("id", conversationId)
        .eq("owner_user_id", userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, conversationId) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
      }
    },
  });
}

export function useRenameConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, title }: { conversationId: string; title: string }) => {
      const { userId } = await getAuthContext();
      const { error } = await supabase
        .from("chat_conversations")
        .update({ title })
        .eq("id", conversationId)
        .eq("owner_user_id", userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });
}

export function useExportChatCsv() {
  return useMutation({
    mutationFn: async (tableId: string) => {
      const api = requireDesktopApi();
      const authContext = await getAuthContext();
      const result = await api.chat.exportCsv({ tableId, ...authContext }) as unknown as {
        filePath?: string;
        error?: string;
      };
      if (result.error) throw new Error(result.error);
      return result;
    },
  });
}

// ============================================================
// Streaming Event Bridge (like useDesktopJobBridge)
// ============================================================

export function useChatStreamBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const api = getDesktopApi();
    if (!api) return undefined;

    const unsubToken = api.onChatToken((event: ChatTokenEvent) => {
      const store = useChatStore.getState();
      // Accept tokens if streaming, regardless of conversation ID match
      // (new conversations start with "pending" ID)
      if (store.isStreaming) {
        if (store.activeConversationId === "pending") {
          store.setActiveConversationId(event.conversationId);
        }
        store.appendToken(event.token);
      }
    });

    const unsubComplete = api.onChatComplete((event: ChatCompleteEvent) => {
      const store = useChatStore.getState();
      store.setActiveConversationId(event.conversationId);
      store.finishStreaming(event.messageId);
      queryClient.invalidateQueries({ queryKey: chatKeys.messages(event.conversationId) });
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      if (event.tableId) {
        queryClient.invalidateQueries({ queryKey: chatKeys.table(event.tableId) });
      }
    });

    const unsubVerification = api.onChatVerificationDone((event: ChatVerificationDoneEvent) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.table(event.tableId) });
    });

    const unsubError = api.onChatError((event: ChatErrorEvent) => {
      const store = useChatStore.getState();
      store.resetStreaming();
      queryClient.invalidateQueries({ queryKey: chatKeys.messages(event.conversationId) });
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    });

    const unsubStatus = api.onChatStatus((event: ChatStatusEvent) => {
      const store = useChatStore.getState();
      if (store.isStreaming) {
        if (store.activeConversationId === "pending") {
          store.setActiveConversationId(event.conversationId);
        }
        if (event.stage) {
          store.setPipelineStage(event.stage, event.message, event.detail);
        } else {
          store.clearPipeline();
        }
      }
    });

    return () => {
      unsubToken();
      unsubComplete();
      unsubVerification();
      unsubError();
      unsubStatus();
    };
  }, [queryClient]);
}

// ============================================================
// LLM Model Selection Hooks
// ============================================================

export function useLlmModels() {
  return useQuery({
    queryKey: llmKeys.models,
    queryFn: async (): Promise<OllamaModel[]> => {
      const api = getDesktopApi();
      if (!api) return [];
      const result = await api.llm.listModels();
      if (!result.success) throw new Error(result.error ?? "Failed to list models");
      return result.data ?? [];
    },
    staleTime: 30_000, // Refresh every 30s
  });
}

export function useActiveLlmModel() {
  return useQuery({
    queryKey: llmKeys.activeModel,
    queryFn: async (): Promise<LlmModelInfo | null> => {
      const api = getDesktopApi();
      if (!api) return null;
      const authContext = await getAuthContext();
      const result = await api.llm.getModel(authContext);
      if (!result.success) throw new Error(result.error ?? "Failed to get model");
      return result.data ?? null;
    },
    staleTime: 60_000,
  });
}

export function useSetLlmModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (model: string) => {
      const api = requireDesktopApi();
      const authContext = await getAuthContext();
      const result = await api.llm.setModel({ model, ...authContext });
      if (!result.success) throw new Error(result.error ?? "Failed to set model");
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: llmKeys.activeModel });
    },
  });
}
