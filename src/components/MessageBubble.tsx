/* ──────────────────────────────────────────────
   MessageBubble — Single chat message
   ────────────────────────────────────────────── */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { ChatMessage, MessageAttachment } from "@/types";
import { useChatState } from "@/store/chat-store";
import { isImageMime, formatBytes } from "@/api/chat-api";

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({
  message,
}: MessageBubbleProps) {
  const { config } = useChatState();
  const isUser = message.role === "user";

  return (
    <div className={`message message--${message.role}`}>
      <div className="message__avatar">
        {isUser ? "U" : "E"}
      </div>
      <div className="message__bubble">
        {isUser ? (
          <>
            {message.attachments?.length ? (
              <MessageAttachments attachments={message.attachments} />
            ) : null}
            {message.content && (
              <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{message.content}</p>
            )}
          </>
        ) : config.enableMarkdown ? (
          <div className="markdown-body">
            {message.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeSanitize]}
              >
                {message.content}
              </ReactMarkdown>
            ) : message.isStreaming ? (
              <span style={{ opacity: 0.5, fontStyle: "italic" }}>…</span>
            ) : (
              <p style={{ opacity: 0.5, fontStyle: "italic" }}>No response</p>
            )}
          </div>
        ) : (
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {message.content || (message.isStreaming ? "…" : "No response")}
          </p>
        )}
      </div>
    </div>
  );
});

/** Render the attachments a user sent with a message (image thumbnails / file chips). */
function MessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  return (
    <div className="message__attachments" data-testid="message-attachments">
      {attachments.map((att, i) => {
        const showImage = isImageMime(att.mimeType) && att.previewUrl;
        const tooLarge = att.forwardableInline === false;
        return (
          <div key={`${att.fileName}-${i}`} className="message__attachment">
            {showImage ? (
              <img src={att.previewUrl} alt={att.fileName} className="message__attachment-img" />
            ) : (
              <div className="message__attachment-file" title={att.fileName}>
                <span>📄</span>
                <div className="message__attachment-file-meta">
                  <span className="message__attachment-file-name">{att.fileName}</span>
                  {att.sizeBytes != null && (
                    <span style={{ opacity: 0.7 }}>{formatBytes(att.sizeBytes)}</span>
                  )}
                </div>
              </div>
            )}
            {tooLarge && (
              <span
                className="message__attachment-warn"
                data-testid="attachment-not-forwarded"
                title="Stored but not sent to the model (too large)."
              >
                ⚠ Not sent to model
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
