import { describe, expect, test, vi } from "vitest";
import { apiV1Request, invalidateWorkspaceRequests, onWorkspaceAccessLost } from "./backendApiV1Client.ts";

describe("workspace request scope", () => {
  test("ignores a late response from the former lab even if transport ignores cancellation", async () => {
    let finish;
    const started = new Promise((resolve) => { finish = resolve; });
    let release;
    const request = apiV1Request("get", "/api/v1/projects", { fetch: async () => {
      finish(); return new Promise((resolve) => { release = resolve; });
    } });
    await started;
    invalidateWorkspaceRequests();
    release(new Response(JSON.stringify({ items: [{ id: "old_project" }] }), { status: 200 }));
    await expect(request).rejects.toHaveProperty("name", "AbortError");
  });
  test("reports revoked scientific access but not invalid invitation errors", async () => {
    const listener = vi.fn();
    const unsubscribe = onWorkspaceAccessLost(listener);
    try {
      await expect(apiV1Request("get", "/api/v1/projects/{projectId}", {
        pathParams: { projectId: "revoked" }, fetch: async () => new Response(JSON.stringify({ error: { code: "project_not_found", message: "Not found" } }), { status: 404 }),
      })).rejects.toHaveProperty("status", 404);
      expect(listener).toHaveBeenCalledWith(404);
      listener.mockClear();
      await expect(apiV1Request("post", "/api/v1/auth/invitations/preview", {
        body: { invitationCode: "x".repeat(43) }, fetch: async () => new Response(JSON.stringify({ error: { code: "invitation_revoked", message: "Revoked" } }), { status: 410 }),
      })).rejects.toHaveProperty("status", 410);
      expect(listener).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });
});
