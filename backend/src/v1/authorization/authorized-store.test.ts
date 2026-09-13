import { expect, test, vi } from "vitest";
import { withWriteAuthorization } from "./authorized-store.js";

test("asynchronous writes recheck authority; revocation cannot finalize a pending task", async () => {
  let allowed = true;
  const repository = { findRegion: vi.fn(async () => ({id:"r"})), createRevision: vi.fn(), updateRegion: vi.fn(), finalizeAnalysisRun: vi.fn() };
  const authorize = vi.fn(async () => {if (!allowed) throw new Error("revoked");});
  const scoped = withWriteAuthorization(repository,authorize);
  expect(await scoped.findRegion()).toEqual({id:"r"});
  expect(authorize).not.toHaveBeenCalled();
  await scoped.createRevision();
  allowed=false;
  await expect(scoped.updateRegion()).rejects.toThrow("revoked");
  await expect(scoped.finalizeAnalysisRun()).rejects.toThrow("revoked");
  expect(repository.updateRegion).not.toHaveBeenCalled();
  expect(repository.finalizeAnalysisRun).not.toHaveBeenCalled();
});
