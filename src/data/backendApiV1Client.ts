import createClient from "openapi-fetch";
import type { paths as BackendApiV1Paths } from "./generated/backendApiV1";

const REQUEST_ORIGIN = "http://labrat.local";
let workspaceEpoch = 0;
let workspaceController = new AbortController();
const accessListeners = new Set<(status: number) => void>();

export function invalidateWorkspaceRequests() {
  workspaceEpoch += 1;
  workspaceController.abort();
  workspaceController = new AbortController();
}

export function onWorkspaceAccessLost(listener: (status: number) => void) {
  accessListeners.add(listener);
  return () => { accessListeners.delete(listener); };
}

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type ApiV1Path = keyof BackendApiV1Paths;
type ApiV1Method<Path extends ApiV1Path> = Extract<keyof BackendApiV1Paths[Path], HttpMethod>;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response | ResponseLike>;

interface ResponseLike {
  ok?: boolean;
  status?: number;
  headers?: HeadersInit;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}

interface RequestOptions {
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetch?: FetchLike;
}

interface ServerApiErrorDetails {
  status?: number | null;
  code?: string | null;
  error?: Record<string, unknown> | null;
  details?: unknown;
  body?: unknown;
}

export class ServerApiError extends Error {
  status: number | null;
  code: string | null;
  error: Record<string, unknown> | null;
  details: unknown;
  body: unknown;

  constructor(message: string, details: ServerApiErrorDetails = {}) {
    super(message);
    this.name = "ServerApiError";
    this.status = details.status || null;
    this.code = details.code || String(details.error?.code || "") || null;
    this.error = details.error || null;
    this.details = details.details || details.error?.details || null;
    this.body = details.body || null;
  }
}

function fetchImplFrom(options: RequestOptions): FetchLike {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ServerApiError("LabRat server API is unavailable in this environment.");
  }
  return fetchImpl as FetchLike;
}

async function normalizeFetchResponse(response: Response | ResponseLike): Promise<Response> {
  if (response instanceof Response) return response.clone();
  const status = Number(response?.status) || 200;
  let body: string | null = null;
  if (typeof response?.text === "function") {
    body = await response.text();
  } else if (typeof response?.json === "function") {
    const value = await response.json();
    body = value == null ? null : JSON.stringify(value);
  }
  const headers = new Headers(response?.headers || {});
  if (body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(body, { status, headers });
}

function compatibleFetch(fetchImpl: FetchLike, originalBody: unknown) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const endpoint = `${url.pathname}${url.search}`;
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const serializedBody = hasBody && !(originalBody instanceof FormData)
      ? await request.clone().text()
      : undefined;
    const body = originalBody instanceof FormData
      ? originalBody
      : serializedBody || undefined;
    const response = await fetchImpl(endpoint, {
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      ...(body !== undefined ? { body } : {}),
      signal: request.signal,
      credentials: request.credentials || "include",
    });
    return normalizeFetchResponse(response);
  };
}

/** Execute one operation from the generated `/api/v1` OpenAPI path map. */
export async function apiV1Request<
  Path extends ApiV1Path,
  Method extends ApiV1Method<Path>,
>(method: Method, path: Path, options: RequestOptions = {}): Promise<any> {
  const epoch = workspaceEpoch;
  const signal = options.signal
    ? AbortSignal.any([options.signal, workspaceController.signal])
    : workspaceController.signal;
  const fetchImpl = fetchImplFrom(options);
  const client = createClient<BackendApiV1Paths>({
    baseUrl: REQUEST_ORIGIN,
    credentials: "include",
    fetch: compatibleFetch(fetchImpl, options.body),
  });
  const request = client.request as unknown as (
    operationMethod: HttpMethod,
    operationPath: ApiV1Path,
    init: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
  const result = await request(method, path, {
    params: {
      ...(options.pathParams ? { path: options.pathParams } : {}),
      ...(options.query ? { query: options.query } : {}),
    },
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    signal,
  });

  if (epoch !== workspaceEpoch || signal.aborted) throw new DOMException("Workspace request cancelled.", "AbortError");
  if (result.response.ok) return result.data;
  const body = result.error && typeof result.error === "object"
    ? result.error as Record<string, unknown>
    : null;
  const error = body?.error && typeof body.error === "object"
    ? body.error as Record<string, unknown>
    : null;
  const sessionExpired = result.response.status === 401 && !path.startsWith("/api/v1/auth/");
  const scientificRoute = !path.includes("member-access") && !path.includes("access-grants")
    && /^\/api\/v1\/(projects|analysis-|workbook-review-sessions|source-documents|chart-specs|manuscripts|agent-runs)/.test(path);
  const lostProject = scientificRoute && (result.response.status === 403
    || (result.response.status === 404 && ["project_not_found", "lab_member_not_found"].includes(String(error?.code))));
  if (sessionExpired || lostProject) {
    for (const listener of accessListeners) listener(result.response.status);
  }
  throw new ServerApiError(
    String(error?.message || `LabRat server request failed with HTTP ${result.response.status}.`),
    { status: result.response.status, error, body },
  );
}
