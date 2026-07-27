/* ──────────────────────────────────────────────
   AgentPicker — shown when the URL names no agent.
   Replaces the old redirect to a hard-coded "default" agent id, which
   404'd on every instance that had no agent literally named "default"
   and left the visitor on a spinner that never resolved.
   ────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchAgents, type AgentSummary } from "@/api/chat-api";
import { ChatHeader } from "@/components/ChatHeader";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; agents: AgentSummary[] };

export function AgentPicker({ environment = "production" }: { environment?: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetchAgents()
      .then((agents) => {
        if (!cancelled) setState({ status: "ready", agents });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Could not reach EDDI.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="chat-widget" data-testid="agent-picker">
      <ChatHeader />

      <div className="agent-picker">
        <h1 className="agent-picker__title">Choose an agent</h1>

        {state.status === "loading" && (
          <p className="agent-picker__hint">Loading agents…</p>
        )}

        {state.status === "error" && (
          <p className="agent-picker__hint" role="alert">
            {state.message}
          </p>
        )}

        {state.status === "ready" && state.agents.length === 0 && (
          <p className="agent-picker__hint">
            No agents have been created yet. Build one in the{" "}
            <a href="/manage/agents/wizard">EDDI Manager</a>, then come back here.
          </p>
        )}

        {state.status === "ready" && state.agents.length > 0 && (
          <>
            <p className="agent-picker__hint">
              Pick an agent to start a conversation.
            </p>
            <ul className="agent-picker__list">
              {state.agents.map((agent) => (
                <li key={agent.agentId}>
                  <Link
                    className="agent-picker__item"
                    to={`/chat/${environment}/${agent.agentId}`}
                  >
                    <span className="agent-picker__name">{agent.name}</span>
                    {agent.description && (
                      <span className="agent-picker__description">
                        {agent.description}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
