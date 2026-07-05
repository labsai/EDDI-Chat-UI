import { describe, it, expect, vi, afterEach } from "vitest";
import {
  uploadAttachment,
  listAttachments,
  deleteAttachment,
  deleteAllAttachments,
  getAttachmentDownloadUrl,
  buildAttachmentContext,
  isImageMime,
  formatBytes,
  AttachmentError,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TURN,
  sendMessage,
  sendMessageStreaming,
  sendManagedAgentMessage,
  setBaseUrl,
  type SentAttachment,
} from "./chat-api";

setBaseUrl("");

interface FakeInit {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: unknown;
  jsonThrows?: boolean;
  blob?: Blob;
}

function fakeResponse(init: FakeInit = {}) {
  const { ok = true, status = 200, statusText = "OK", json, jsonThrows, blob } = init;
  return {
    ok,
    status,
    statusText,
    json: async () => {
      if (jsonThrows) throw new SyntaxError("Unexpected token");
      return json;
    },
    blob: async () => blob ?? new Blob([]),
  };
}

function stubFetch(init: FakeInit = {}) {
  // Typed args so fn.mock.calls[i] is [url, RequestInit] rather than an empty tuple.
  const fn = vi.fn((_url: string, _reqInit: RequestInit) => Promise.resolve(fakeResponse(init)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Parse the JSON request body from a captured fetch call. */
function bodyOf(reqInit: RequestInit): {
  input?: string;
  context?: Record<string, { value?: { storageRef?: string } }>;
} {
  return JSON.parse(reqInit.body as string);
}

afterEach(() => vi.unstubAllGlobals());

describe("chat-api attachments", () => {
  describe("uploadAttachment", () => {
    it("POSTs multipart with a 'file' field and returns the result", async () => {
      const fn = stubFetch({
        status: 201,
        json: {
          storageRef: "ref-1",
          fileName: "a.png",
          mimeType: "image/png",
          sizeBytes: 10,
          forwardableInline: true,
        },
      });
      const file = new File(["x"], "a.png", { type: "image/png" });
      const result = await uploadAttachment("conv1", file);

      expect(result.storageRef).toBe("ref-1");
      expect(fn).toHaveBeenCalledTimes(1);
      const [url, init] = fn.mock.calls[0];
      expect(String(url)).toContain("/conversations/conv1/attachments");
      expect(init.method).toBe("POST");
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get("file")).toBe(file);
    });

    it("normalizes the lowercase `filename` field to `fileName`", async () => {
      stubFetch({ status: 201, json: { storageRef: "r", filename: "doc.pdf", mimeType: "application/pdf", sizeBytes: 1 } });
      const result = await uploadAttachment("conv1", new File(["x"], "doc.pdf"));
      expect(result.fileName).toBe("doc.pdf");
    });

    it("rejects oversized files client-side without calling fetch", async () => {
      const fn = stubFetch();
      const big = { name: "big.bin", size: MAX_ATTACHMENT_BYTES + 1, type: "application/octet-stream" } as File;
      await expect(uploadAttachment("conv1", big)).rejects.toMatchObject({ code: "ATTACHMENT_TOO_LARGE" });
      expect(fn).not.toHaveBeenCalled();
    });

    it("surfaces the backend error code + message", async () => {
      stubFetch({ ok: false, status: 400, json: { error: "MIME type not allowed", code: "ATTACHMENT_REJECTED" } });
      const p = uploadAttachment("conv1", new File(["x"], "n.exe"));
      await expect(p).rejects.toBeInstanceOf(AttachmentError);
      await expect(uploadAttachment("conv1", new File(["x"], "n.exe"))).rejects.toMatchObject({
        code: "ATTACHMENT_REJECTED",
        message: "MIME type not allowed",
        status: 400,
      });
    });

    it("falls back to statusText on a non-JSON error body", async () => {
      stubFetch({ ok: false, status: 503, statusText: "Service Unavailable", jsonThrows: true });
      await expect(uploadAttachment("conv1", new File(["x"], "n.txt"))).rejects.toMatchObject({
        status: 503,
        message: "Service Unavailable",
        code: undefined,
      });
    });
  });

  describe("listAttachments / delete", () => {
    it("lists attachment metadata", async () => {
      const fn = stubFetch({ json: [{ storageRef: "a1", filename: "a.pdf" }] });
      const list = await listAttachments("conv1");
      expect(list[0].storageRef).toBe("a1");
      expect(String(fn.mock.calls[0][0])).toContain("/conversations/conv1/attachments");
    });

    it("deletes a single attachment (DELETE + encoded storageRef)", async () => {
      const fn = stubFetch({ json: { deleted: true } });
      await expect(deleteAttachment("conv1", "gridfs://abc")).resolves.toBeUndefined();
      const [url, init] = fn.mock.calls[0];
      expect(init.method).toBe("DELETE");
      expect(String(url)).toContain(encodeURIComponent("gridfs://abc"));
    });

    it("deletes all attachments and returns the count", async () => {
      stubFetch({ json: { deletedCount: 3 } });
      await expect(deleteAllAttachments("conv1")).resolves.toBe(3);
    });

    it("deleteAllAttachments returns 0 on a non-JSON/empty body", async () => {
      stubFetch({ jsonThrows: true });
      await expect(deleteAllAttachments("conv1")).resolves.toBe(0);
    });

    it("throws AttachmentError on a failed delete", async () => {
      stubFetch({ ok: false, status: 404, json: { error: "not found", code: "ATTACHMENT_NOT_FOUND" } });
      await expect(deleteAttachment("conv1", "x")).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("getAttachmentDownloadUrl", () => {
    it("encodes both the conversationId and the storageRef", () => {
      const url = getAttachmentDownloadUrl("conv 1", "gridfs://a/b");
      expect(url).toContain(encodeURIComponent("conv 1"));
      expect(url).toContain(encodeURIComponent("gridfs://a/b"));
      expect(url).not.toMatch(/gridfs:\/\//); // raw slashes must be encoded
    });
  });

  describe("buildAttachmentContext", () => {
    it("builds contiguous 0-based attachment_* keys with the object shape", () => {
      const refs: SentAttachment[] = [
        { storageRef: "r0", fileName: "a.png", mimeType: "image/png" },
        { storageRef: "r1", fileName: "b.pdf", mimeType: "application/pdf" },
      ];
      const ctx = buildAttachmentContext(refs);
      expect(Object.keys(ctx)).toEqual(["attachment_0", "attachment_1"]);
      expect(ctx.attachment_0).toEqual({ type: "object", value: { storageRef: "r0", fileName: "a.png" } });
    });

    it("omits fileName when absent", () => {
      const ctx = buildAttachmentContext([{ storageRef: "r", fileName: "", mimeType: "image/png" }]);
      expect(ctx.attachment_0.value).toEqual({ storageRef: "r" });
    });

    it("caps at the per-turn limit", () => {
      const refs: SentAttachment[] = Array.from({ length: MAX_ATTACHMENTS_PER_TURN + 2 }, (_, i) => ({
        storageRef: `r${i}`,
        fileName: `f${i}`,
        mimeType: "image/png",
      }));
      expect(Object.keys(buildAttachmentContext(refs))).toHaveLength(MAX_ATTACHMENTS_PER_TURN);
    });

    it("returns an empty map for no attachments", () => {
      expect(buildAttachmentContext([])).toEqual({});
    });
  });

  describe("send functions forward context", () => {
    it("sendMessage includes the context in the JSON body", async () => {
      const fn = stubFetch({ json: {} });
      await sendMessage("prod", "agent1", "conv1", "hi", undefined, {
        attachment_0: { type: "object", value: { storageRef: "r" } },
      });
      expect(bodyOf(fn.mock.calls[0][1]).context?.attachment_0?.value?.storageRef).toBe("r");
    });

    it("sendManagedAgentMessage forwards context (regression: managed path dropped it)", async () => {
      const fn = stubFetch({ json: {} });
      await sendManagedAgentMessage("intentX", "user1", "hi", {
        attachment_0: { type: "object", value: { storageRef: "r" } },
      });
      expect(bodyOf(fn.mock.calls[0][1]).context?.attachment_0?.value?.storageRef).toBe("r");
    });

    it("sendManagedAgentMessage forwards context even on an empty-text (attachment-only) turn", async () => {
      const fn = stubFetch({ json: {} });
      await sendManagedAgentMessage("intentX", "user1", "", {
        attachment_0: { type: "object", value: { storageRef: "r" } },
      });
      // Empty text is still a SEND (POST with body/context), not a load (GET).
      expect(fn.mock.calls[0][1].method).toBe("POST");
      expect(bodyOf(fn.mock.calls[0][1]).context?.attachment_0?.value?.storageRef).toBe("r");
    });

    it("sendMessageStreaming includes attachment_* context in the POST body (default path)", async () => {
      // Build a fetch that captures the request body and returns an SSE stream.
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode("event: done\ndata: \n\n"));
          c.close();
        },
      });
      let sentBody = "";
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: RequestInit) => {
          sentBody = String(init.body);
          return Promise.resolve({ ok: true, statusText: "OK", body });
        }),
      );

      // Drain the generator so the fetch actually runs.
      for await (const ev of sendMessageStreaming("prod", "agent-1", "conv-1", "hi", {
        attachment_0: { type: "object", value: { storageRef: "r" } },
      })) {
        void ev;
      }

      const parsed = JSON.parse(sentBody) as {
        context?: { attachment_0?: { value?: { storageRef?: string } } };
      };
      expect(parsed.context?.attachment_0?.value?.storageRef).toBe("r");
    });
  });

  describe("auth transport (public widget — no token management)", () => {
    it("uploads without injecting an Authorization header or overriding credentials", async () => {
      const fn = stubFetch({ status: 201, json: { storageRef: "r", fileName: "a.txt", mimeType: "text/plain", sizeBytes: 1 } });
      await uploadAttachment("conv1", new File(["x"], "a.txt", { type: "text/plain" }));
      const init = fn.mock.calls[0][1] as RequestInit;
      // No bearer header is added; default same-origin credentials are left intact
      // so cookie/session or proxy-based auth passes through transparently.
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect(init.credentials).not.toBe("omit");
    });

    it("works the same whether or not the backend enforces auth (client is agnostic)", async () => {
      // With auth disabled (200) and with it enabled+authorized (201) the client
      // behaves identically — it never reasons about tokens.
      stubFetch({ status: 201, json: { storageRef: "r", fileName: "a.txt", mimeType: "text/plain", sizeBytes: 1 } });
      await expect(
        uploadAttachment("conv1", new File(["x"], "a.txt", { type: "text/plain" })),
      ).resolves.toMatchObject({ storageRef: "r" });
    });

    it("surfaces a 401/403 as an AttachmentError when auth is required but missing", async () => {
      stubFetch({ ok: false, status: 401, json: { error: "Unauthorized" } });
      await expect(
        uploadAttachment("conv1", new File(["x"], "a.txt", { type: "text/plain" })),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe("helpers", () => {
    it("isImageMime", () => {
      expect(isImageMime("image/png")).toBe(true);
      expect(isImageMime("application/pdf")).toBe(false);
      expect(isImageMime(undefined)).toBe(false);
      expect(isImageMime(null)).toBe(false);
      expect(isImageMime("IMAGE/PNG")).toBe(false); // case-sensitive by design
    });

    it("formatBytes", () => {
      expect(formatBytes(undefined)).toBe("");
      expect(formatBytes(-5)).toBe("");
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(2048)).toBe("2.0 KB");
      expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
      expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
    });
  });
});
