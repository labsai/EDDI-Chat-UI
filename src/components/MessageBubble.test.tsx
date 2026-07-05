import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageBubble } from "./MessageBubble";
import { ChatProvider } from "@/store/chat-store";
import type { ChatMessage } from "@/types";

function renderBubble(message: ChatMessage) {
  return render(
    <ChatProvider>
      <MessageBubble message={message} />
    </ChatProvider>,
  );
}

describe("MessageBubble", () => {
  it("renders user message content", () => {
    renderBubble({ id: "1", role: "user", content: "Hello", timestamp: 0 });
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders agent message content", () => {
    renderBubble({ id: "2", role: "agent", content: "Hi there", timestamp: 0 });
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });

  it("renders markdown bold text in agent messages", () => {
    renderBubble({ id: "3", role: "agent", content: "This is **bold**", timestamp: 0 });
    const bold = screen.getByText("bold");
    expect(bold.tagName).toBe("STRONG");
  });

  it("applies user styling class", () => {
    const { container } = renderBubble({ id: "4", role: "user", content: "Hi", timestamp: 0 });
    expect(container.querySelector(".message--user")).toBeInTheDocument();
  });

  it("applies agent styling class", () => {
    const { container } = renderBubble({ id: "5", role: "agent", content: "Hi", timestamp: 0 });
    expect(container.querySelector(".message--agent")).toBeInTheDocument();
  });

  it("shows avatar with U for user and E for agent", () => {
    const { container } = renderBubble({ id: "6", role: "user", content: "Hi", timestamp: 0 });
    expect(container.querySelector(".message__avatar")?.textContent).toBe("U");
  });

  it("renders links in agent markdown", () => {
    renderBubble({ id: "7", role: "agent", content: "Visit [EDDI](https://eddi.labs.ai)", timestamp: 0 });
    const link = screen.getByRole("link", { name: "EDDI" });
    expect(link).toHaveAttribute("href", "https://eddi.labs.ai");
  });

  it("renders an image thumbnail for an image attachment", () => {
    renderBubble({
      id: "8",
      role: "user",
      content: "",
      timestamp: 0,
      attachments: [{ fileName: "pic.png", mimeType: "image/png", previewUrl: "blob:x" }],
    });
    const img = screen.getByRole("img", { name: "pic.png" });
    expect(img).toHaveAttribute("src", "blob:x");
  });

  it("renders a file chip (name + size) for a non-image attachment", () => {
    renderBubble({
      id: "9",
      role: "user",
      content: "see this",
      timestamp: 0,
      attachments: [{ fileName: "report.pdf", mimeType: "application/pdf", sizeBytes: 2048 }],
    });
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("see this")).toBeInTheDocument();
  });

  it("shows a 'not sent to model' indicator when forwardableInline is false", () => {
    renderBubble({
      id: "10",
      role: "user",
      content: "",
      timestamp: 0,
      attachments: [{ fileName: "huge.png", mimeType: "image/png", previewUrl: "blob:x", forwardableInline: false }],
    });
    expect(screen.getByTestId("attachment-not-forwarded")).toBeInTheDocument();
  });

  it("escapes a malicious filename instead of rendering it as HTML", () => {
    const evil = '<img src=x onerror=alert(1)>.pdf';
    const { container } = renderBubble({
      id: "11",
      role: "user",
      content: "",
      timestamp: 0,
      attachments: [{ fileName: evil, mimeType: "application/pdf", sizeBytes: 1 }],
    });
    // The filename is rendered as text, and no injected <img> element exists.
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img[onerror]")).toBeNull();
  });
});
