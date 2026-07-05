import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatInput } from "./ChatInput";
import { ChatProvider } from "@/store/chat-store";
import { AttachmentError } from "@/api/chat-api";

vi.mock("@/api/chat-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chat-api")>();
  return { ...actual, uploadAttachment: vi.fn(), deleteAttachment: vi.fn().mockResolvedValue(undefined) };
});
import { uploadAttachment, deleteAttachment } from "@/api/chat-api";

// jsdom doesn't implement object-URL APIs — stub them per test.
const origCreate = URL.createObjectURL;
const origRevoke = URL.revokeObjectURL;
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  URL.createObjectURL = origCreate;
  URL.revokeObjectURL = origRevoke;
  vi.clearAllMocks();
});

function renderInput(props = {}) {
  const onSend = vi.fn();
  const result = render(
    <ChatProvider>
      <ChatInput onSend={onSend} {...props} />
    </ChatProvider>,
  );
  return { ...result, onSend };
}

describe("ChatInput", () => {
  it("renders a textarea and send button", () => {
    renderInput();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    expect(screen.getByTestId("chat-send")).toBeInTheDocument();
  });

  it("calls onSend on Enter key", () => {
    const { onSend } = renderInput();
    const textarea = screen.getByTestId("chat-input");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("Hello", false);
  });

  it("does NOT send on Shift+Enter", () => {
    const { onSend } = renderInput();
    const textarea = screen.getByTestId("chat-input");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does NOT send when input is empty", () => {
    const { onSend } = renderInput();
    const textarea = screen.getByTestId("chat-input");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does NOT send when disabled", () => {
    const { onSend } = renderInput({ disabled: true });
    const textarea = screen.getByTestId("chat-input");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears input after send", () => {
    renderInput();
    const textarea = screen.getByTestId("chat-input") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(textarea.value).toBe("");
  });

  it("uploads a picked file and forwards it as an attachment on send", async () => {
    vi.mocked(uploadAttachment).mockResolvedValue({
      storageRef: "ref-1",
      fileName: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      forwardableInline: true,
    });
    const { onSend } = renderInput({ conversationId: "conv1" });

    const fileInput = screen.getByTestId("chat-file-input");
    const file = new File(["hi there!"], "note.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Pending chip appears once the upload resolves.
    expect(await screen.findByTestId("attachment-chip")).toBeInTheDocument();
    expect(uploadAttachment).toHaveBeenCalledWith("conv1", file);

    // Sending forwards the uploaded attachment as the third onSend arg.
    const textarea = screen.getByTestId("chat-input");
    fireEvent.change(textarea, { target: { value: "look" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    const [msg, isSecret, attachments] = onSend.mock.calls[0];
    expect(msg).toBe("look");
    expect(isSecret).toBe(false);
    expect(attachments?.[0]?.storageRef).toBe("ref-1");
  });

  it("shows an error on the chip and excludes it from the sent attachments", async () => {
    vi.mocked(uploadAttachment).mockRejectedValue(
      new AttachmentError("MIME type not allowed", 400, "ATTACHMENT_REJECTED"),
    );
    const { onSend } = renderInput({ conversationId: "conv1" });

    fireEvent.change(screen.getByTestId("chat-file-input"), {
      target: { files: [new File(["x"], "bad.exe", { type: "text/plain" })] },
    });

    const chip = await screen.findByTestId("attachment-chip");
    await waitFor(() => expect(chip.className).toContain("chat-attachment--error"));

    // Text + errored attachment → send goes through with NO attachments.
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.keyDown(screen.getByTestId("chat-input"), { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][2]).toBeUndefined();
  });

  it("enforces the per-turn cap in the UI", async () => {
    vi.mocked(uploadAttachment).mockImplementation(async (_c, f) => ({
      storageRef: `ref-${f.name}`,
      fileName: f.name,
      mimeType: "text/plain",
      sizeBytes: 1,
      forwardableInline: true,
    }));
    renderInput({ conversationId: "conv1" });

    const files = Array.from({ length: 6 }, (_, i) =>
      new File(["x"], `f${i}.txt`, { type: "text/plain" }),
    );
    fireEvent.change(screen.getByTestId("chat-file-input"), { target: { files } });

    await waitFor(() =>
      expect(screen.getAllByTestId("attachment-chip")).toHaveLength(5),
    );
  });

  it("disables the attach button when there is no conversation", () => {
    renderInput();
    expect(screen.getByTestId("chat-attach-btn")).toBeDisabled();
  });

  it("removing a ready chip calls deleteAttachment and revokes the preview", async () => {
    vi.mocked(uploadAttachment).mockResolvedValue({
      storageRef: "ref-1",
      fileName: "pic.png",
      mimeType: "image/png",
      sizeBytes: 5,
      forwardableInline: true,
    });
    renderInput({ conversationId: "conv1" });

    fireEvent.change(screen.getByTestId("chat-file-input"), {
      target: { files: [new File(["x"], "pic.png", { type: "image/png" })] },
    });
    await screen.findByTestId("attachment-chip");
    await waitFor(() => expect(screen.getByTestId("attachment-remove")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("attachment-remove"));

    await waitFor(() =>
      expect(screen.queryByTestId("attachment-chip")).not.toBeInTheDocument(),
    );
    expect(deleteAttachment).toHaveBeenCalledWith("conv1", "ref-1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("warns on the chip when an upload is stored but too large to forward inline", async () => {
    vi.mocked(uploadAttachment).mockResolvedValue({
      storageRef: "ref-big",
      fileName: "big.txt",
      mimeType: "text/plain",
      sizeBytes: 15_000_000,
      forwardableInline: false,
    });
    renderInput({ conversationId: "conv1" });

    fireEvent.change(screen.getByTestId("chat-file-input"), {
      target: { files: [new File(["x"], "big.txt", { type: "text/plain" })] },
    });

    const chip = await screen.findByTestId("attachment-chip");
    await waitFor(() => expect(chip.textContent).toContain("Too large to send to model"));
    expect(chip.querySelector(".chat-attachment__sub--warn")).not.toBeNull();
  });

  it("keeps the send button disabled while an upload is in flight", async () => {
    let resolveUpload: (v: unknown) => void = () => {};
    vi.mocked(uploadAttachment).mockReturnValue(
      new Promise((res) => {
        resolveUpload = res as (v: unknown) => void;
      }) as ReturnType<typeof uploadAttachment>,
    );
    renderInput({ conversationId: "conv1" });

    const textarea = screen.getByTestId("chat-input");
    fireEvent.change(textarea, { target: { value: "hi" } });

    const fileInput = screen.getByTestId("chat-file-input");
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] },
    });

    // While uploading, send is blocked.
    await waitFor(() =>
      expect(screen.getByTestId("chat-send")).toBeDisabled(),
    );

    resolveUpload({
      storageRef: "r",
      fileName: "a.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      forwardableInline: true,
    });
    await waitFor(() =>
      expect(screen.getByTestId("chat-send")).not.toBeDisabled(),
    );
  });
});
