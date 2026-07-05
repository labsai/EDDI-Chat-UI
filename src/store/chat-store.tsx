/* ──────────────────────────────────────────────
   EDDI Chat — State Management
   Lightweight Context + useReducer (no zustand).
   ────────────────────────────────────────────── */

import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { ChatMessage, QuickReply, ConversationState, ChatConfig, InputField } from "@/types";

/* ─── State ───────────────────────────────────── */

export interface ChatState {
  messages: ChatMessage[];
  conversationId: string | null;
  conversationState: ConversationState | null;
  quickReplies: QuickReply[];
  isProcessing: boolean;
  isThinking: boolean;
  /** True while a model cascade is escalating to a more capable model. */
  isEscalating: boolean;
  undoAvailable: boolean;
  redoAvailable: boolean;
  agentName: string | null;
  config: ChatConfig;
  /** Set when the backend requests a specific input field (e.g. password). */
  activeInputField: InputField | null;
  /** Set when the user toggles the 🔒 secret mode on the chat input. */
  isSecretMode: boolean;
}

const defaultConfig: ChatConfig = {
  theme: "dark",
  accentColor: "#113B92",
  showLogo: true,
  logoUrl: "/img/logo_eddi.png",
  title: "EDDI",
  placeholder: "Type a message...",
  enableStreaming: true,
  enableQuickReplies: true,
  enableMarkdown: true,
  enableMath: true,
  enableCodeHighlight: true,
  enableUndo: true,
  enableRedo: true,
  enableNewConversation: true,
  showAgentName: true,
};

export const initialState: ChatState = {
  messages: [],
  conversationId: null,
  conversationState: null,
  quickReplies: [],
  isProcessing: false,
  isThinking: false,
  isEscalating: false,
  undoAvailable: false,
  redoAvailable: false,
  agentName: null,
  config: defaultConfig,
  activeInputField: null,
  isSecretMode: false,
};

/* ─── Actions ─────────────────────────────────── */

export type ChatAction =
  | { type: "SET_CONVERSATION_ID"; id: string | null }
  | { type: "SET_CONVERSATION_STATE"; state: ConversationState }
  | { type: "ADD_MESSAGE"; message: ChatMessage }
  | { type: "APPEND_TO_LAST_AGENT"; token: string }
  | { type: "FINISH_STREAMING" }
  | { type: "SET_QUICK_REPLIES"; replies: QuickReply[] }
  | { type: "SET_PROCESSING"; value: boolean }
  | { type: "SET_THINKING"; value: boolean }
  | { type: "SET_ESCALATING"; value: boolean }
  | { type: "SET_UNDO_REDO"; undoAvailable: boolean; redoAvailable: boolean }
  | { type: "REPLACE_MESSAGES"; messages: ChatMessage[] }
  | { type: "SET_AGENT_NAME"; name: string | null }
  | { type: "CLEAR_MESSAGES" }
  | { type: "SET_CONFIG"; config: Partial<ChatConfig> }
  | { type: "SET_INPUT_FIELD"; field: InputField }
  | { type: "CLEAR_INPUT_FIELD" }
  | { type: "TOGGLE_SECRET_MODE" };

/* ─── Reducer ─────────────────────────────────── */

/** Free object URLs held by message attachment previews before messages are dropped. */
function revokeMessagePreviews(messages: ChatMessage[]): void {
  for (const message of messages) {
    message.attachments?.forEach((a) => {
      if (a.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(a.previewUrl);
    });
  }
}

/**
 * Carry client-only attachment previews from the previous messages onto rebuilt
 * ones, matched by user-message order. Snapshots (from undo/redo) never carry
 * attachments, so without this an earlier image message loses its thumbnail when
 * a later turn is undone.
 */
function preserveAttachments(prev: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  const prevUserAttachments = prev.filter((m) => m.role === "user").map((m) => m.attachments);
  let i = 0;
  return next.map((m) => {
    if (m.role !== "user") return m;
    const att = prevUserAttachments[i++];
    return att && att.length ? { ...m, attachments: att } : m;
  });
}

/** Revoke only the preview URLs present in `prev` that no message in `next` still references. */
function revokeOrphanedPreviews(prev: ChatMessage[], next: ChatMessage[]): void {
  const kept = new Set<string>();
  next.forEach((m) => m.attachments?.forEach((a) => a.previewUrl && kept.add(a.previewUrl)));
  prev.forEach((m) =>
    m.attachments?.forEach((a) => {
      if (a.previewUrl?.startsWith("blob:") && !kept.has(a.previewUrl)) URL.revokeObjectURL(a.previewUrl);
    }),
  );
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_CONVERSATION_ID":
      return { ...state, conversationId: action.id };

    case "SET_CONVERSATION_STATE":
      return { ...state, conversationState: action.state };

    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };

    case "APPEND_TO_LAST_AGENT": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "agent") {
        msgs[msgs.length - 1] = { ...last, content: last.content + action.token };
      }
      return { ...state, messages: msgs };
    }

    case "FINISH_STREAMING": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "agent") {
        msgs[msgs.length - 1] = { ...last, isStreaming: false };
      }
      return { ...state, messages: msgs, isProcessing: false, isThinking: false, isEscalating: false };
    }

    case "SET_QUICK_REPLIES":
      return { ...state, quickReplies: action.replies };

    case "SET_PROCESSING":
      return { ...state, isProcessing: action.value };

    case "SET_THINKING":
      return { ...state, isThinking: action.value };

    case "SET_ESCALATING":
      return { ...state, isEscalating: action.value };

    case "CLEAR_MESSAGES":
      revokeMessagePreviews(state.messages);
      return {
        ...state,
        messages: [],
        conversationId: null,
        quickReplies: [],
        conversationState: null,
        isThinking: false,
        isEscalating: false,
        undoAvailable: false,
        redoAvailable: false,
        activeInputField: null,
        isSecretMode: false,
      };

    case "SET_UNDO_REDO":
      return { ...state, undoAvailable: action.undoAvailable, redoAvailable: action.redoAvailable };

    case "REPLACE_MESSAGES": {
      // Undo/redo rebuild messages from a snapshot (no attachments). Carry the
      // client-side previews forward so thumbnails survive, and revoke only the
      // previews that are genuinely gone.
      const merged = preserveAttachments(state.messages, action.messages);
      revokeOrphanedPreviews(state.messages, merged);
      return { ...state, messages: merged };
    }

    case "SET_AGENT_NAME":
      return { ...state, agentName: action.name };

    case "SET_CONFIG":
      return { ...state, config: { ...state.config, ...action.config } };

    case "SET_INPUT_FIELD":
      return { ...state, activeInputField: action.field };

    case "CLEAR_INPUT_FIELD":
      return { ...state, activeInputField: null };

    case "TOGGLE_SECRET_MODE":
      return { ...state, isSecretMode: !state.isSecretMode };

    default:
      return state;
  }
}

/* ─── Context ─────────────────────────────────── */

const ChatStateContext = createContext<ChatState>(initialState);
const ChatDispatchContext = createContext<Dispatch<ChatAction>>(() => {});

export function ChatProvider({
  children,
  config,
}: {
  children: ReactNode;
  config?: Partial<ChatConfig>;
}) {
  const [state, dispatch] = useReducer(chatReducer, {
    ...initialState,
    config: { ...defaultConfig, ...config },
  });

  return (
    <ChatStateContext.Provider value={state}>
      <ChatDispatchContext.Provider value={dispatch}>
        {children}
      </ChatDispatchContext.Provider>
    </ChatStateContext.Provider>
  );
}

export function useChatState(): ChatState {
  return useContext(ChatStateContext);
}

export function useChatDispatch(): Dispatch<ChatAction> {
  return useContext(ChatDispatchContext);
}
