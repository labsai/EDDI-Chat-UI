import { describe, it, expect, vi, afterEach } from "vitest";
import { sendMessageStreaming } from "./chat-api";

/** Build a ReadableStream that emits the given SSE text chunks then closes. */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("sendMessageStreaming — cascade SSE events", () => {
  it("yields cascade events and passes unknown event types through without breaking the stream", async () => {
    const body = sseStream([
      'event: cascade_step_start\ndata: {"stepIndex":0,"modelName":"gpt-4o-mini"}\n\n',
      'event: cascade_escalation\ndata: {"fromStep":0,"toStep":1,"confidence":0.6,"threshold":0.7}\n\n',
      "event: some_future_event\ndata: {}\n\n",
      "event: token\ndata: Hi\n\n",
      "event: done\ndata: \n\n",
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, statusText: "OK", body })),
    );

    const events = [];
    for await (const e of sendMessageStreaming("prod", "agent-1", "conv-1", "hello")) {
      events.push(e);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("cascade_step_start");
    expect(types).toContain("cascade_escalation");
    // Unknown/forward-compatible events are still surfaced, not dropped or fatal.
    expect(types).toContain("some_future_event");
    expect(types).toContain("token");
    expect(types).toContain("done");

    // The escalation event carries its JSON payload intact.
    const escalation = events.find((e) => e.type === "cascade_escalation");
    expect(escalation?.data).toContain('"toStep":1');
  });
});
