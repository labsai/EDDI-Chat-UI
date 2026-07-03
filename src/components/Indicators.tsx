/* ──────────────────────────────────────────────
   TypingIndicator — Bouncing dots (agent is typing)
   ThinkingIndicator — Pulsing brain (agent is thinking)
   ────────────────────────────────────────────── */

/** Three bouncing dots shown while the agent is composing a response. */
export function TypingIndicator() {
  return (
    <div className="indicator" data-testid="typing-indicator">
      <div className="indicator__avatar">
        E
      </div>
      <div className="indicator__bubble">
        <div className="indicator__dots">
          <span className="indicator__dot" />
          <span className="indicator__dot" />
          <span className="indicator__dot" />
        </div>
      </div>
    </div>
  );
}

/** Shown when the agent is in a thinking/reasoning phase (e.g. tool calls, RAG). */
export function ThinkingIndicator() {
  return (
    <div className="indicator" data-testid="thinking-indicator">
      <div className="indicator__avatar">
        E
      </div>
      <div className="indicator__bubble">
        <div className="indicator__thinking">
          <span className="indicator__brain">🧠</span>
          <span>Thinking…</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown when a model cascade escalates to a more capable model. Deliberately
 * generic — end users see only that the agent is working harder, never the
 * model names, confidence, or cost (those are admin-only details).
 */
export function EscalatingIndicator() {
  return (
    <div className="indicator" data-testid="escalating-indicator">
      <div className="indicator__avatar">
        E
      </div>
      <div className="indicator__bubble">
        <div className="indicator__thinking">
          <span className="indicator__brain">⚡</span>
          <span>Thinking harder…</span>
        </div>
      </div>
    </div>
  );
}
