/* ──────────────────────────────────────────────
   EDDI Chat — API Layer
   Pure fetch-based, zero external dependencies.
   v6: simplified paths — all conversation-scoped ops use only conversationId.
   ────────────────────────────────────────────── */

import type {
  ConversationSnapshot,
  SSEEvent,
  SSEEventType,
} from "@/types";

/**
 * A conversation context entry. `value` is a string for simple flags
 * (e.g. `secretInput`) or an object for structured entries such as
 * `attachment_*` keys (`{ storageRef, fileName }`).
 */
export type ChatContext = Record<string, { type: string; value: unknown }>;

let _baseUrl = "";

/** Set the API base URL (e.g. from ChatConfig). Call once at startup. */
export function setBaseUrl(url: string): void {
  _baseUrl = url.replace(/\/$/, "");
}

function buildUrl(path: string): string {
  return `${_baseUrl}${path}`;
}

/** Encode a single path segment so /, ?, # in data don't break the URL. */
function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

/* ─── Conversation lifecycle ─────────────────── */

/**
 * Start a new conversation.
 * Returns the conversation ID extracted from the Location header.
 */
export async function startConversation(
  _environment: string,
  agentId: string,
  userId?: string,
): Promise<string> {
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const res = await fetch(
    buildUrl(`/agents/${encodeSegment(agentId)}/start${params}`),
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`Failed to start conversation: ${res.statusText}`);

  const location = res.headers.get("Location");
  if (!location) {
    throw new Error(
      "startConversation: server did not return a Location header",
    );
  }
  const segments = location.split("/");
  const last = segments[segments.length - 1] || location;
  return last.split("?")[0];
}

/**
 * Read an existing conversation (GET).
 * Used after start (to pick up welcome messages) and to resume.
 * @param _environment - Unused in v6 API (kept for caller compatibility)
 * @param _agentId - Unused in v6 API (kept for caller compatibility)
 */
export async function readConversation(
  _environment: string,
  _agentId: string,
  conversationId: string,
  currentStepOnly = false,
): Promise<ConversationSnapshot> {
  const params = new URLSearchParams({
    returnDetailed: "false",
    returnCurrentStepOnly: String(currentStepOnly),
  });
  const res = await fetch(
    buildUrl(`/agents/${encodeSegment(conversationId)}?${params}`),
  );
  if (!res.ok) throw new Error(`Failed to read conversation: ${res.statusText}`);
  return res.json();
}

/**
 * Send a message (non-streaming) to a direct agent.
 * Returns the conversation snapshot with the agent's reply in `conversationOutputs`.
 * When `context` is provided, sends as JSON `InputData` instead of plain text.
 * @param _environment - Unused in v6 API (kept for caller compatibility)
 * @param _agentId - Unused in v6 API (kept for caller compatibility)
 */
export async function sendMessage(
  _environment: string,
  _agentId: string,
  conversationId: string,
  message: string,
  userId?: string,
  context?: ChatContext,
): Promise<ConversationSnapshot> {
  const params = new URLSearchParams({
    returnDetailed: "false",
    returnCurrentStepOnly: "true",
  });
  if (userId) params.set("userId", userId);

  const hasContext = context && Object.keys(context).length > 0;

  const res = await fetch(
    buildUrl(`/agents/${encodeSegment(conversationId)}?${params}`),
    {
      method: "POST",
      headers: {
        "Content-Type": hasContext ? "application/json" : "text/plain",
      },
      body: hasContext
        ? JSON.stringify({ input: message, context })
        : message,
    },
  );
  if (!res.ok) throw new Error(`Failed to send message: ${res.statusText}`);
  return res.json();
}

/**
 * Send a message via SSE streaming.
 * Yields parsed SSE events as they arrive.
 * @param _environment - Unused in v6 API (kept for caller compatibility)
 * @param _agentId - Unused in v6 API (kept for caller compatibility)
 */
export async function* sendMessageStreaming(
  _environment: string,
  _agentId: string,
  conversationId: string,
  message: string,
  context?: ChatContext,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const body: Record<string, unknown> = { input: message };
  if (context && Object.keys(context).length > 0) {
    body.context = context;
  }

  const res = await fetch(
    buildUrl(`/agents/${encodeSegment(conversationId)}/stream`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  );

  if (!res.ok) throw new Error(`Streaming failed: ${res.statusText}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No readable stream");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Normalize CRLF → LF so the parser works with any line ending
      buffer = buffer.replace(/\r\n/g, "\n");

      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.trim()) continue;
        let eventType: SSEEventType = "token";
        const dataLines: string[] = [];

        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim() as SSEEventType;
          } else if (line.startsWith("data:")) {
            // Per SSE spec, join multiple data: lines with newlines
            dataLines.push(line.slice(5).trim());
          }
        }

        const eventData = dataLines.join("\n");

        if (eventData || eventType) {
          yield { type: eventType, data: eventData };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/* ─── Managed agent endpoints ──────────────────── */

/**
 * Send a message to a managed agent (intent-based routing).
 * v6: path changed from /managedagents to /agents/managed
 */
export async function sendManagedAgentMessage(
  intent: string,
  userId: string,
  message?: string,
  context?: ChatContext,
): Promise<ConversationSnapshot> {
  const params = new URLSearchParams({
    returnDetailed: "false",
    returnCurrentStepOnly: "true",
  });
  const url = buildUrl(
    `/agents/managed/${encodeSegment(intent)}/${encodeSegment(userId)}?${params}`,
  );

  // A defined message (even "") means "send a turn" → POST with body + context;
  // an omitted message means "load the conversation" → GET. Using truthiness here
  // would misroute an attachment-only turn (empty text) to the context-less GET.
  if (message != null) {
    const body: Record<string, unknown> = { input: message };
    if (context && Object.keys(context).length > 0) body.context = context;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to send message: ${res.statusText}`);
    return res.json();
  } else {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`Failed to load conversation: ${res.statusText}`);
    return res.json();
  }
}

/**
 * End a conversation.
 */
export async function endConversation(
  conversationId: string,
): Promise<void> {
  const res = await fetch(
    buildUrl(`/agents/${encodeSegment(conversationId)}/endConversation`),
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`Failed to end conversation: ${res.statusText}`);
}

/* ─── Undo / Redo ────────────────────────────── */

/**
 * Undo the last conversation step.
 */
export async function undoConversation(
  _environment: string,
  _agentId: string,
  conversationId: string,
): Promise<ConversationSnapshot> {
  const res = await fetch(
    buildUrl(`/agents/${encodeSegment(conversationId)}/undo`),
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`Failed to undo: ${res.statusText}`);
  return res.json();
}

/**
 * Redo a previously undone conversation step.
 */
export async function redoConversation(
  _environment: string,
  _agentId: string,
  conversationId: string,
): Promise<ConversationSnapshot> {
  const res = await fetch(
    buildUrl(`/agents/${encodeSegment(conversationId)}/redo`),
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`Failed to redo: ${res.statusText}`);
  return res.json();
}

/* ─── Agent descriptor ─────────────────────────── */

/**
 * Fetch the agent document descriptor to get the agent's display name.
 * Uses the GET /agentstore/agents/:agentId endpoint.
 */
export async function fetchAgentDescriptor(
  agentId: string,
): Promise<{ name?: string; description?: string }> {
  const res = await fetch(
    buildUrl(`/agentstore/agents/${encodeSegment(agentId)}`),
  );
  if (!res.ok) return {};
  try {
    const data = await res.json();
    return {
      name: data?.resource?.name ?? data?.name,
      description: data?.resource?.description ?? data?.description,
    };
  } catch {
    return {};
  }
}

/* ─── Attachments ────────────────────────────── */

/**
 * Largest file the backend accepts on upload
 * (`eddi.attachments.max-size-bytes`, default 20 MiB). Validated client-side.
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * Largest file the backend inlines into an LLM message
 * (`eddi.attachments.max-forward-bytes`, default 10 MiB). Larger files are
 * stored and downloadable but not "seen" inline (`forwardableInline: false`).
 */
export const MAX_FORWARD_BYTES = 10 * 1024 * 1024;

/**
 * Backend per-turn cap on forwarded attachments
 * (`AttachmentContextExtractor.DEFAULT_MAX_ATTACHMENTS_PER_TURN`).
 */
export const MAX_ATTACHMENTS_PER_TURN = 5;

/** Response body of a successful upload (`201`). */
export interface AttachmentResult {
  storageRef: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  conversationId?: string;
  /** `false` when the file is too large to forward inline to the model. */
  forwardableInline?: boolean;
}

/** Attachment metadata from the list endpoint (backend uses lowercase `filename`). */
export interface AttachmentMeta {
  storageRef: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  conversationId?: string;
}

/** An uploaded attachment being sent with a turn (context ref + display preview). */
export interface SentAttachment {
  storageRef: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  forwardableInline?: boolean;
  /** Object URL for an inline image preview on the sent bubble. */
  previewUrl?: string;
}

/** Error carrying the HTTP status and backend error code. */
export class AttachmentError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AttachmentError";
    this.status = status;
    this.code = code;
  }
}

/** True for MIME types that can be shown as an inline image preview. */
export function isImageMime(mimeType?: string | null): boolean {
  return !!mimeType && mimeType.startsWith("image/");
}

/** Human-readable byte size, e.g. `1.4 MB`. */
export function formatBytes(bytes?: number): string {
  if (bytes == null || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function normalizeFileName(raw: { fileName?: string; filename?: string }): string {
  return raw.fileName ?? raw.filename ?? "";
}

async function toAttachmentError(res: Response): Promise<AttachmentError> {
  let message = res.statusText || "Request failed";
  let code: string | undefined;
  try {
    const body = await res.json();
    message = body.error ?? body.message ?? message;
    code = body.code;
  } catch {
    // Non-JSON error body — keep the status text.
  }
  return new AttachmentError(message, res.status, code);
}

/**
 * Upload a file attachment to a conversation.
 * POST /conversations/{conversationId}/attachments (multipart/form-data).
 * Rejects oversized files client-side; surfaces backend error codes.
 */
export async function uploadAttachment(
  conversationId: string,
  file: File,
): Promise<AttachmentResult> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError(
      `File too large: ${formatBytes(file.size)} (max ${formatBytes(MAX_ATTACHMENT_BYTES)})`,
      400,
      "ATTACHMENT_TOO_LARGE",
    );
  }

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(
    buildUrl(`/conversations/${encodeSegment(conversationId)}/attachments`),
    { method: "POST", body: formData },
  );

  if (!res.ok) throw await toAttachmentError(res);

  const result = (await res.json()) as AttachmentResult & { filename?: string };
  return { ...result, fileName: normalizeFileName(result) };
}

/** List attachment metadata owned by a conversation. */
export async function listAttachments(
  conversationId: string,
): Promise<AttachmentMeta[]> {
  const res = await fetch(
    buildUrl(`/conversations/${encodeSegment(conversationId)}/attachments`),
  );
  if (!res.ok) throw await toAttachmentError(res);
  return res.json();
}

/** Build the download URL for one attachment. */
export function getAttachmentDownloadUrl(
  conversationId: string,
  storageRef: string,
): string {
  return buildUrl(
    `/conversations/${encodeSegment(conversationId)}/attachments/${encodeSegment(storageRef)}`,
  );
}

/** Delete a single attachment. */
export async function deleteAttachment(
  conversationId: string,
  storageRef: string,
): Promise<void> {
  const res = await fetch(getAttachmentDownloadUrl(conversationId, storageRef), {
    method: "DELETE",
  });
  if (!res.ok) throw await toAttachmentError(res);
}

/** Delete every attachment for a conversation (GDPR erasure). Returns the count. */
export async function deleteAllAttachments(
  conversationId: string,
): Promise<number> {
  const res = await fetch(
    buildUrl(`/conversations/${encodeSegment(conversationId)}/attachments`),
    { method: "DELETE" },
  );
  if (!res.ok) throw await toAttachmentError(res);
  try {
    const body = await res.json();
    return typeof body?.deletedCount === "number" ? body.deletedCount : 0;
  } catch {
    return 0;
  }
}

/**
 * Build the `attachment_*` context map that forwards uploaded attachments to the
 * LLM on the next turn. Caps at {@link MAX_ATTACHMENTS_PER_TURN}. Sending only
 * `{ storageRef, fileName }` lets the backend resolve the trusted MIME / size.
 */
export function buildAttachmentContext(attachments: SentAttachment[]): ChatContext {
  const context: ChatContext = {};
  attachments.slice(0, MAX_ATTACHMENTS_PER_TURN).forEach((att, index) => {
    context[`attachment_${index}`] = {
      type: "object",
      value: att.fileName
        ? { storageRef: att.storageRef, fileName: att.fileName }
        : { storageRef: att.storageRef },
    };
  });
  return context;
}
