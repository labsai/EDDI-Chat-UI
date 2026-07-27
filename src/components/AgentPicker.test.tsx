/* ──────────────────────────────────────────────
   AgentPicker — the no-agent-in-the-URL landing.

   Guards the regression it was written for: the router used to redirect this
   case to a hard-coded "default" agent id, which 404'd on any instance without
   an agent by that name and stranded the visitor on a spinner.
   ────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { AgentPicker } from "./AgentPicker";
import { ChatWidget } from "./ChatWidget";
import { ChatProvider } from "@/store/chat-store";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function descriptor(id: string, name: string, description?: string) {
  return {
    resource: `eddi://ai.labs.agent/agentstore/agents/${id}?version=1`,
    name,
    description,
  };
}

function renderPicker(entry = "/chat/production") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ChatProvider>
        <Routes>
          <Route path="/chat/:environment" element={<AgentPicker />} />
          <Route path="*" element={<AgentPicker />} />
          <Route
            path="/chat/:environment/:agentId"
            element={<ChatWidget />}
          />
        </Routes>
      </ChatProvider>
    </MemoryRouter>,
  );
}

describe("AgentPicker", () => {
  it("lists the agents the instance actually has", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json([
        descriptor("agent-1", "Support Bot", "Answers support questions"),
        descriptor("agent-2", "Sales Bot"),
      ]),
    ) as typeof fetch;

    renderPicker();

    expect(await screen.findByText("Support Bot")).toBeTruthy();
    expect(screen.getByText("Sales Bot")).toBeTruthy();
    expect(screen.getByText("Answers support questions")).toBeTruthy();
  });

  it("links each agent to its own chat route", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json([descriptor("agent-1", "Support Bot")]),
    ) as typeof fetch;

    renderPicker();

    const link = await screen.findByText("Support Bot");
    expect(link.closest("a")?.getAttribute("href")).toBe(
      "/chat/production/agent-1",
    );
  });

  it("never starts a conversation with a made-up agent id", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) =>
      Response.json([descriptor("agent-1", "Support Bot")]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderPicker();
    await screen.findByText("Support Bot");

    const called = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(called.some((u) => u.includes("/agents/default/start"))).toBe(false);
    expect(called.some((u) => u.includes("/start"))).toBe(false);
  });

  it("explains the empty case instead of showing a dead spinner", async () => {
    globalThis.fetch = vi.fn(async () => Response.json([])) as typeof fetch;

    renderPicker();

    expect(
      await screen.findByText(/No agents have been created yet/i),
    ).toBeTruthy();
  });

  it("surfaces a backend failure rather than hanging", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("boom", { status: 500 }),
    ) as typeof fetch;

    renderPicker();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  it("handles an unknown path the same way", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json([descriptor("agent-1", "Support Bot")]),
    ) as typeof fetch;

    renderPicker("/something/else");

    expect(await screen.findByTestId("agent-picker")).toBeTruthy();
  });
});
