import { DOCUMENT_LIMITS, documentError } from "./documentLimits.js";
import { DOCLING_OPTIONS } from "./doclingPages.js";

export function createDoclingClient({ endpoint, apiKey, fetchImpl = fetch }) {
  if (!endpoint || !apiKey) throw documentError("document_service_unavailable", "PDF recognition is not configured.", 503);
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw documentError("document_service_config", "PDF recognition endpoint must be an internal service origin.", 503);
  }
  // Only the local host or the fixed private Compose service is authorized.
  // Supporting any other destination requires a separate reviewed deployment change.
  if (!["127.0.0.1", "localhost", "[::1]", "docling"].includes(url.hostname)) {
    throw documentError("document_service_config", "PDF recognition must use the local Docling service.", 503);
  }
  const taskPath = (id) => {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw documentError("document_task_invalid", "The parsing task identifier is invalid.");
    return encodeURIComponent(id);
  };
  const request = async (route, { signal, body, method = "GET", cap = 64 * 1024 } = {}) => {
    const deadline = AbortSignal.timeout(30_000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response;
    try {
      response = await fetchImpl(new URL(route, url), { method, body, signal: combined,
        redirect: "error", headers: { "X-Api-Key": apiKey, Accept: "application/json" } });
      if (!response.ok) {
        await response.body?.cancel();
        const code = response.status === 404 ? "document_task_missing" : [401, 403].includes(response.status)
          ? "document_service_config" : response.status === 413 ? "document_too_large" : "document_service_unavailable";
        throw documentError(code, "PDF recognition service could not complete the request.", 503);
      }
      if (Number(response.headers.get("content-length")) > cap) {
        await response.body?.cancel(); throw documentError("document_index_limit", "The parser result exceeds its size limit.");
      }
      const chunks = []; let bytes = 0;
      if (!response.body) throw documentError("document_docling_result_invalid", "The parser returned an empty result.");
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > cap) throw documentError("document_index_limit", "The parser result exceeds its size limit.");
        chunks.push(chunk);
      }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw documentError("document_docling_result_invalid", "The parser returned invalid JSON."); }
    } catch (error) {
      if (signal?.aborted) throw documentError("document_cancelled", "Document processing stopped.", 409);
      if (error?.code?.startsWith("document_")) throw error;
      throw documentError("document_service_unavailable", "PDF recognition service is temporarily unavailable.", 503);
    }
  };
  return {
    async verifyVersion(signal) {
      const actual = await request("/version", { signal });
      const expected = { "docling-serve": "1.21.0", docling: "2.96.1", "docling-core": "2.78.0",
        "docling-jobkit": "1.20.1", "docling-ibm-models": "3.13.2", "docling-parse": "6.2.0" };
      if (Object.entries(expected).some(([key, value]) => actual[key] !== value)) {
        throw documentError("document_service_version", "The parser service does not match this processing version.", 503);
      }
    },
    async submit(buffer, signal) {
      if (buffer.length > DOCUMENT_LIMITS.fileBytes) throw documentError("document_too_large", "The document exceeds 25 MiB.", 413);
      const body = new FormData();
      for (const [key, value] of Object.entries(DOCLING_OPTIONS)) body.append(key, value);
      // A generic name avoids leaking project or user-provided path information.
      body.append("files", new Blob([buffer], { type: "application/pdf" }), "document.pdf");
      const result = await request("/v1/convert/file/async", { method: "POST", body, signal });
      taskPath(result.task_id); return String(result.task_id);
    },
    async status(id, signal) {
      const result = await request(`/v1/status/poll/${taskPath(id)}?wait=2`, { signal });
      if (!["pending", "started", "success", "failure", "cancelled"].includes(result.task_status)) {
        throw documentError("document_task_invalid", "The parser returned an unknown task state.");
      }
      return result.task_status;
    },
    result: (id, signal) => request(`/v1/result/${taskPath(id)}`, { signal, cap: DOCUMENT_LIMITS.resultBytes }),
    clearExpired: (signal) => request("/v1/clear/results?older_then=3600", { signal }),
  };
}
