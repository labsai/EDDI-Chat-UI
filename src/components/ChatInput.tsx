/* ──────────────────────────────────────────────
   ChatInput — Auto-growing textarea + send button
   With 🔒 secret mode toggle and multimodal file attachments.
   ────────────────────────────────────────────── */

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";
import { useChatState, useChatDispatch } from "@/store/chat-store";
import {
  uploadAttachment,
  deleteAttachment,
  isImageMime,
  formatBytes,
  AttachmentError,
  MAX_ATTACHMENTS_PER_TURN,
  type AttachmentResult,
  type SentAttachment,
} from "@/api/chat-api";

interface ChatInputProps {
  onSend: (message: string, isSecret?: boolean, attachments?: SentAttachment[]) => void;
  disabled?: boolean;
  conversationId?: string | null;
}

/** A file the user picked, tracked through upload → ready/error. */
interface PendingAttachment {
  id: string;
  file: File;
  previewUrl?: string;
  status: "uploading" | "ready" | "error";
  result?: AttachmentResult;
  error?: string;
}

export function ChatInput({ onSend, disabled, conversationId }: ChatInputProps) {
  const { isProcessing, config, isSecretMode } = useChatState();
  const dispatch = useChatDispatch();
  const [value, setValue] = useState("");
  const [secretVisible, setSecretVisible] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Attachment upload ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const isUploading = pendingAttachments.some((a) => a.status === "uploading");
  const hasReadyAttachment = pendingAttachments.some((a) => a.status === "ready");

  // Mirror the pending list in a ref so handleAttach reads a live count for the
  // per-turn cap without being re-created (and without a stale closure).
  const pendingRef = useRef(pendingAttachments);
  useEffect(() => {
    pendingRef.current = pendingAttachments;
  }, [pendingAttachments]);

  // Reset (and free) pending attachments when the conversation changes, so a
  // storageRef uploaded to one conversation is never sent to another.
  useEffect(() => {
    setPendingAttachments((prev) => {
      prev.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
      return [];
    });
  }, [conversationId]);

  // Free any unsent preview URLs if the composer unmounts (e.g. quick-reply →
  // ENDED, or a secret-input swap) — those transitions don't change
  // conversationId, so nothing else would revoke them.
  useEffect(
    () => () => {
      pendingRef.current.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    },
    [],
  );

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    // Allow an attachment-only turn (empty text) once a file has uploaded.
    if ((!trimmed && !hasReadyAttachment) || disabled || isProcessing || isUploading) return;

    const sent: SentAttachment[] = pendingAttachments
      .filter((a): a is PendingAttachment & { result: AttachmentResult } =>
        a.status === "ready" && !!a.result)
      .map((a) => ({
        storageRef: a.result.storageRef,
        fileName: a.result.fileName || a.file.name,
        mimeType: a.result.mimeType || a.file.type || "application/octet-stream",
        sizeBytes: a.result.sizeBytes ?? a.file.size,
        forwardableInline: a.result.forwardableInline,
        previewUrl: a.previewUrl,
      }));

    if (sent.length) {
      onSend(trimmed, isSecretMode, sent);
    } else {
      onSend(trimmed, isSecretMode);
    }
    setValue("");
    // Ready attachments hand their preview URL to the sent message (don't revoke);
    // free the URLs of any not-forwarded (errored) chips being dropped here.
    const forwarded = new Set(sent.map((s) => s.previewUrl).filter(Boolean));
    pendingAttachments.forEach((a) => {
      if (a.previewUrl && !forwarded.has(a.previewUrl)) URL.revokeObjectURL(a.previewUrl);
    });
    pendingRef.current = [];
    setPendingAttachments([]);
    if (isSecretMode) {
      dispatch({ type: "TOGGLE_SECRET_MODE" });
      setSecretVisible(false);
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, hasReadyAttachment, disabled, isProcessing, isUploading, isSecretMode, pendingAttachments, onSend, dispatch]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, []);

  const toggleSecretMode = useCallback(() => {
    dispatch({ type: "TOGGLE_SECRET_MODE" });
    setSecretVisible(false);
  }, [dispatch]);

  const handleAttach = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (!files.length || !conversationId) return;

      // Enforce the per-turn cap up front (errored chips don't consume a slot).
      const activeCount = pendingRef.current.filter((a) => a.status !== "error").length;
      const room = Math.max(0, MAX_ATTACHMENTS_PER_TURN - activeCount);
      const accepted = files.slice(0, room);
      if (!accepted.length) return;

      // Build entries once — object URLs are created here, never inside a state
      // updater (StrictMode double-invokes updaters and would orphan a blob URL).
      const entries: PendingAttachment[] = accepted.map((file, i) => ({
        id: `att-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: isImageMime(file.type) ? URL.createObjectURL(file) : undefined,
        status: "uploading",
      }));
      pendingRef.current = [...pendingRef.current, ...entries];
      setPendingAttachments((prev) => [...prev, ...entries]);

      await Promise.all(
        entries.map(async (entry) => {
          try {
            const result = await uploadAttachment(conversationId, entry.file);
            setPendingAttachments((prev) =>
              prev.map((a) => (a.id === entry.id ? { ...a, status: "ready", result } : a)),
            );
          } catch (err) {
            const message =
              err instanceof AttachmentError ? err.message : "Failed to upload file";
            setPendingAttachments((prev) =>
              prev.map((a) => (a.id === entry.id ? { ...a, status: "error", error: message } : a)),
            );
          }
        }),
      );
    },
    [conversationId],
  );

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      // Side effects run OUTSIDE the state updater — StrictMode double-invokes
      // updaters, which would fire a duplicate DELETE / revoke.
      const target = pendingRef.current.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      if (target?.status === "ready" && target.result && conversationId) {
        deleteAttachment(conversationId, target.result.storageRef).catch(() => {});
      }
      setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
    },
    [conversationId],
  );

  const canSend =
    (value.trim().length > 0 || hasReadyAttachment) && !disabled && !isProcessing && !isUploading;

  return (
    <div className="chat-input">
      {/* Hidden file input for attachments */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleAttach}
        data-testid="chat-file-input"
      />

      {/* Pending attachment chips */}
      {pendingAttachments.length > 0 && (
        <div className="chat-input__attachments" data-testid="pending-attachments">
          {pendingAttachments.map((att) => (
            <PendingAttachmentChip
              key={att.id}
              att={att}
              onRemove={() => handleRemoveAttachment(att.id)}
            />
          ))}
        </div>
      )}

      <div className="chat-input__row">
        {/* 📎 Attach button */}
        <button
          type="button"
          className="chat-input__attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={!conversationId || isUploading}
          title="Attach file"
          data-testid="chat-attach-btn"
          aria-label="Attach file"
        >
          {isUploading ? "⏳" : "📎"}
        </button>
        {/* 🔒 Secret mode toggle */}
        <button
          type="button"
          className={`chat-input__secret-toggle ${isSecretMode ? "chat-input__secret-toggle--active" : ""}`}
          onClick={toggleSecretMode}
          title={isSecretMode ? "Secret mode ON — input will be encrypted" : "Toggle secret mode"}
          data-testid="chat-secret-toggle"
          aria-label="Toggle secret mode"
        >
          {isSecretMode ? "🔒" : "🔓"}
        </button>

        {isSecretMode ? (
          /* Secret mode: password input with eye toggle */
          <div className="chat-input__secret-wrapper">
            <input
              type={secretVisible ? "text" : "password"}
              data-testid="chat-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter secret value..."
              disabled={disabled}
              className="chat-input__secret-field"
              autoComplete="off"
            />
            <button
              type="button"
              className="chat-input__eye-toggle"
              onClick={() => setSecretVisible((v) => !v)}
              title={secretVisible ? "Hide" : "Show"}
              aria-label={secretVisible ? "Hide secret" : "Show secret"}
              data-testid="chat-eye-toggle"
            >
              {secretVisible ? "👁" : "👁‍🗨"}
            </button>
          </div>
        ) : (
          /* Normal mode: auto-growing textarea */
          <textarea
            ref={textareaRef}
            data-testid="chat-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            placeholder={config.placeholder ?? "Type a message..."}
            disabled={disabled}
            rows={1}
            className="chat-input__textarea"
          />
        )}

        <button
          data-testid="chat-send"
          onClick={handleSend}
          disabled={!canSend}
          className={`chat-input__send ${canSend ? "chat-input__send--active" : "chat-input__send--disabled"}`}
          aria-label="Send message"
        >
          {isProcessing ? <span className="chat-input__spinner" /> : "➤"}
        </button>
      </div>
    </div>
  );
}

/** A single pending-attachment chip: thumbnail/icon, name, size, status + remove. */
function PendingAttachmentChip({
  att,
  onRemove,
}: {
  att: PendingAttachment;
  onRemove: () => void;
}) {
  const isImage = isImageMime(att.file.type) && att.previewUrl;
  const isError = att.status === "error";

  return (
    <div
      className={`chat-attachment ${isError ? "chat-attachment--error" : ""}`}
      title={att.error ?? att.file.name}
      data-testid="attachment-chip"
    >
      {isImage ? (
        <img src={att.previewUrl} alt={att.file.name} className="chat-attachment__thumb" />
      ) : (
        <span className="chat-attachment__icon">{isError ? "⚠️" : "📄"}</span>
      )}
      <div className="chat-attachment__meta">
        <span className="chat-attachment__name">{att.file.name}</span>
        <span
          className={`chat-attachment__sub${
            att.result?.forwardableInline === false ? " chat-attachment__sub--warn" : ""
          }`}
        >
          {att.status === "uploading"
            ? "Uploading…"
            : isError
              ? att.error ?? "Failed"
              : att.result?.forwardableInline === false
                ? "Too large to send to model"
                : formatBytes(att.result?.sizeBytes ?? att.file.size)}
        </span>
      </div>
      {att.status === "uploading" ? (
        <span className="chat-attachment__spinner" />
      ) : (
        <button
          type="button"
          className="chat-attachment__remove"
          onClick={onRemove}
          title="Remove"
          aria-label="Remove attachment"
          data-testid="attachment-remove"
        >
          ✕
        </button>
      )}
    </div>
  );
}
