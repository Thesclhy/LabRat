import { describe, expect, it, vi } from "vitest";
import {
  createExperimentCustomColumn,
  createManualExperiment,
  deleteExperimentCustomColumn,
  deleteManualExperiment,
  createExperimentBrowserView,
  deleteExperimentAnnotation,
  deleteExperimentBrowserView,
  getExperimentBrowserDetail,
  getProjectBrowserConfig,
  listExperimentBrowserRows,
  listExperimentBrowserViews,
  listExperimentAnnotations,
  saveExperimentAnnotation,
  saveExperimentCustomValue,
  saveManualExperimentValue,
  updateExperimentCustomColumn,
  updateManualExperiment,
  updateExperimentBrowserView,
  updateProjectBrowserConfig,
} from "./experimentBrowserApi.js";

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe("experimentBrowserApi", () => {
  it("bounds legacy picker page sizes to v1 and preserves the continuation cursor", async () => {
    const fetch = vi.fn(async () => ok({ rows: [{ experimentId: 'exp_1' }], nextCursor: 'next_page' }));
    const response = await listExperimentBrowserRows('project_1', { limit: 1000, cursor: 'first_page' }, { fetch });
    const url = new URL(fetch.mock.calls[0][0], 'http://localhost');
    expect(url.searchParams.get('limit')).toBe('250');
    expect(url.searchParams.get('cursor')).toBe('first_page');
    expect(response.nextCursor).toBe('next_page');
  });

  it("encodes bounded list query state without sending undefined values", async () => {
    const fetch = vi.fn(async () => ok({ rows: [] }));
    await listExperimentBrowserRows("project / 1", {
      search: "high yield",
      filters: [{ columnId: "field:yield:percent:number", operator: "gte", value: 40 }],
      sort: [{ columnId: "experiment", direction: "asc" }],
      cursor: "cursor_1",
      limit: 125,
      starredOnly: true,
    }, { fetch });

    const [endpoint, options] = fetch.mock.calls[0];
    const url = new URL(endpoint, "http://localhost");
    expect(url.pathname).toBe("/api/v1/projects/project%20%2F%201/experiment-browser");
    expect(url.searchParams.get("search")).toBe("high yield");
    expect(JSON.parse(url.searchParams.get("filters"))).toEqual([
      { columnId: "field:yield:percent:number", operator: "gte", value: 40 },
    ]);
    expect(JSON.parse(url.searchParams.get("sort"))).toEqual([{ columnId: "experiment", direction: "asc" }]);
    expect(url.searchParams.get("cursor")).toBe("cursor_1");
    expect(url.searchParams.get("limit")).toBe("125");
    expect(url.searchParams.get("starredOnly")).toBe("true");
    expect(options.credentials).toBe("include");
  });

  it("saves and removes personal experiment annotations through project-scoped paths", async () => {
    const fetch = vi.fn(async () => ok({ experimentAnnotation: { experimentId: "experiment / 1" } }));
    await saveExperimentAnnotation("project / 1", "experiment / 1", { note: "Important", color: "blue" }, { fetch });
    await deleteExperimentAnnotation("project / 1", "experiment / 1", { fetch });
    await listExperimentAnnotations("project / 1", { fetch });

    expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/api/v1/projects/project%20%2F%201/experiments/experiment%20%2F%201/annotation",
      "/api/v1/projects/project%20%2F%201/experiments/experiment%20%2F%201/annotation",
      "/api/v1/projects/project%20%2F%201/experiment-annotations",
    ]);
    expect(fetch.mock.calls.map(([, options]) => options.method || "GET")).toEqual(["PUT", "DELETE", "GET"]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ note: "Important", color: "blue" });
  });

  it("loads detail through the project-scoped experiment path", async () => {
    const fetch = vi.fn(async () => ok({ experiment: { id: "experiment / 1" } }));
    await getExperimentBrowserDetail("project / 1", "experiment / 1", { fetch });

    expect(fetch.mock.calls[0][0]).toBe("/api/v1/projects/project%20%2F%201/experiments/experiment%20%2F%201");
  });

  it("creates, renames, edits, and deletes shared custom documentation columns", async () => {
    const fetch = vi.fn(async () => ok({}));
    await createExperimentCustomColumn("project / 1", "Follow-up", { fetch });
    await updateExperimentCustomColumn("project / 1", "column / 1", { label: "Decision", expectedVersion: 1 }, { fetch });
    await saveExperimentCustomValue("project / 1", "column / 1", "experiment / 1", { value: "Repeat", expectedVersion: 0 }, { fetch });
    await deleteExperimentCustomColumn("project / 1", "column / 1", { fetch });

    expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/api/v1/projects/project%20%2F%201/experiment-custom-columns",
      "/api/v1/projects/project%20%2F%201/experiment-custom-columns/column%20%2F%201",
      "/api/v1/projects/project%20%2F%201/experiment-custom-columns/column%20%2F%201/experiments/experiment%20%2F%201",
      "/api/v1/projects/project%20%2F%201/experiment-custom-columns/column%20%2F%201",
    ]);
    expect(fetch.mock.calls.map(([, options]) => options.method || "GET")).toEqual(["POST", "PATCH", "PUT", "DELETE"]);
  });

  it("maps the v1 custom column and value envelopes onto the keys the Browser reads", async () => {
    const column = { id: "column_1", label: "Follow-up", version: 1 };
    const value = { id: "value_1", value: "Repeat", version: 3 };
    const fetch = vi.fn(async (endpoint) => ok(endpoint.includes("/experiments/") ? { customValue: value } : { customColumn: column }));
    expect(await createExperimentCustomColumn("project_1", "Follow-up", { fetch })).toEqual({ experimentCustomColumn: column });
    expect(await updateExperimentCustomColumn("project_1", "column_1", { label: "Follow-up", expectedVersion: 1 }, { fetch })).toEqual({ experimentCustomColumn: column });
    expect(await saveExperimentCustomValue("project_1", "column_1", "exp_1", { value: "Repeat", expectedVersion: 2 }, { fetch })).toEqual({ experimentCustomValue: value });
  });

  it("creates, updates, and deletes manually logged rows", async () => {
    const manual = { id: "manual_1", experimentId: "experiment / 1", label: "Pilot run", note: "", version: 1 };
    const fetch = vi.fn(async () => ok({ manualExperiment: manual }));
    expect(await createManualExperiment("project / 1", { label: "  Pilot run " }, { fetch })).toEqual(manual);
    expect(await updateManualExperiment("project / 1", "experiment / 1", { note: "Repeat", expectedVersion: 1 }, { fetch })).toEqual(manual);
    await deleteManualExperiment("project / 1", "experiment / 1", { fetch });

    expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/api/v1/projects/project%20%2F%201/experiments",
      "/api/v1/projects/project%20%2F%201/experiments/experiment%20%2F%201",
      "/api/v1/projects/project%20%2F%201/experiments/experiment%20%2F%201",
    ]);
    expect(fetch.mock.calls.map(([, options]) => options.method || "GET")).toEqual(["POST", "PATCH", "DELETE"]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ label: "Pilot run" });
    await expect(createManualExperiment("", { label: "x" })).rejects.toThrow("Select a project");

    const valueFetch = vi.fn(async () => ok({ manualValue: { columnId: "field:temp", value: "275", version: 1 } }));
    expect(await saveManualExperimentValue("project / 1", "experiment / 1", "field:temp", { value: "275", expectedVersion: 0 }, { fetch: valueFetch }))
      .toEqual({ columnId: "field:temp", value: "275", version: 1 });
    expect(valueFetch.mock.calls[0][0]).toBe("/api/v1/projects/project%20%2F%201/experiments/experiment%20%2F%201/manual-values");
    expect(JSON.parse(valueFetch.mock.calls[0][1].body)).toEqual({ columnId: "field:temp", value: "275", expectedVersion: 0 });
  });

  it("requires project and experiment identifiers", async () => {
    await expect(listExperimentBrowserRows()).rejects.toThrow("Select a project");
    await expect(getExperimentBrowserDetail("project_1")).rejects.toThrow("Select an experiment");
  });

  it("lists, creates, updates, and deletes personal BrowserViews", async () => {
    const fetch = vi.fn(async () => ok({ browserViews: [] }));
    const payload = { columns: [], filters: [], sort: [], groupBy: null, selectedExperimentIds: ["exp_1"] };

    await listExperimentBrowserViews("project_1", { fetch });
    await createExperimentBrowserView("project_1", { name: "My view", payload, isDefault: true }, { fetch });
    await updateExperimentBrowserView("project_1", "view / 1", { name: "Renamed", payload }, { fetch });
    await deleteExperimentBrowserView("project_1", "view / 1", { fetch });

    expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/api/v1/projects/project_1/browser-views",
      "/api/v1/projects/project_1/browser-views",
      "/api/v1/projects/project_1/browser-views/view%20%2F%201",
      "/api/v1/projects/project_1/browser-views/view%20%2F%201",
    ]);
    expect(fetch.mock.calls.map(([, options]) => options.method || "GET")).toEqual(["GET", "POST", "PATCH", "DELETE"]);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ name: "My view", payload, isDefault: true });
  });

  it("loads and version-updates the shared project Browser configuration", async () => {
    const fetch = vi.fn(async () => ok({ projectBrowserConfig: null, canEdit: true }));
    const payload = { columns: [], filters: [], sort: [] };

    await getProjectBrowserConfig("project / 1", { fetch });
    await updateProjectBrowserConfig("project / 1", { expectedVersion: 0, payload }, { fetch });

    expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/api/v1/projects/project%20%2F%201/browser-config",
      "/api/v1/projects/project%20%2F%201/browser-config",
    ]);
    expect(fetch.mock.calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ expectedVersion: 0, payload });
  });
});
