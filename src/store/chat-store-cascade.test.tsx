import { describe, it, expect } from "vitest";
import { chatReducer, initialState, type ChatState } from "./chat-store";

describe("chatReducer — cascade escalation", () => {
  it("SET_ESCALATING toggles the flag", () => {
    const on = chatReducer(initialState, { type: "SET_ESCALATING", value: true });
    expect(on.isEscalating).toBe(true);
    const off = chatReducer(on, { type: "SET_ESCALATING", value: false });
    expect(off.isEscalating).toBe(false);
  });

  it("FINISH_STREAMING clears isEscalating (alongside thinking/processing)", () => {
    const state: ChatState = {
      ...initialState,
      isEscalating: true,
      isThinking: true,
      isProcessing: true,
      messages: [{ id: "a", role: "agent", content: "x", timestamp: 1, isStreaming: true }],
    };
    const result = chatReducer(state, { type: "FINISH_STREAMING" });
    expect(result.isEscalating).toBe(false);
    expect(result.isThinking).toBe(false);
    expect(result.isProcessing).toBe(false);
  });

  it("CLEAR_MESSAGES clears isEscalating", () => {
    const state: ChatState = { ...initialState, isEscalating: true };
    const result = chatReducer(state, { type: "CLEAR_MESSAGES" });
    expect(result.isEscalating).toBe(false);
  });
});
