import { describe, expect, it, vi } from "vitest";
import {
  createExperimentCustomColumn,
  deleteExperimentCustomColumn,
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
  updateExperimentCustomColumn,
  updateExperimentBrowserView,
  updateProjectBrowserConfig,
} from "./experimentBrowserApi.js";

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe("experimentBrowserApi", () => {
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
    expect(url.pathname).toBe("/api/projects/project%20%2F%201/experiment-browser");
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
      "/api/projects/project%20%2F%201/experiments/experiment%20%2F%201/annotation",
      "/api/projects/project%20%2F%201/experiments/experiment%20%2F%201/annotation",
      "/api/projects/project%20%2F%201/experiment-annotations",
    ]);
    expect(fetch.mock.calls.map(([, options]) => options.method || "GET")).toEqual(["PUT", "DELETE", "GET"]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ note: "Important", color: "blue" });
  });

  it("loads detail through the project-scoped experiment path", async () => {
    const fetch = vi.fn(async () => ok({ experiment: { id: "experiment / 1" } }));
    await getExperimentBrowserDetail("project / 1", "experiment / 1", { fetch });

    expect(fetch.mock.calls[0][0]).toBe("/api/projects/project%20%2F%201/experiments/experiment%20%2F%201");
  });

  it("creates, renames, edits, and deletes shared custom documentation columns", async () => {
    const fetch = vi.fn(async () => ok({}));
    await createExperimentCustomColumn("project / 1", "Follow-up", { fetch });
    await updateExperimentCustomColumn("project / 1", "column / 1", { label: "Decision", expectedVersion: 1 }, { fetch });
    await saveExperimentCustomValue("project / 1", "column / 1", "experiment / 1", { value: "Repeat", expectedVersion: 0 }, { fetch });
    await deleteExperimentCustomColumn("project / 1", "column / 1", { fetch });

    expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/api/projects/project%20%2F%201/experiment-custom-columns",
      "/api/projects/project%20%2F%201/experiment-custom-columns/column%20%2F%201",
      "/api/projects/project%20%2F%201/experiment-custom-columns/column%20%2F%201/experiments/experiment%20%2F%201",
      "/api/projects/project%20%2F%201/experiment-custom-columns/column%20%2F%201",
    ]);
    expect(fetch.mock.calls.map(([, options]) => options.method || "GET")).toEqual(["POST", "PATCH", "PUT", "DELETE"]);
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
      "/api/projects/project_1/browser-views",
      "/api/projects/project_1/browser-views",
      "/api/projects/project_1/browser-views/view%20%2F%201",
      "/api/projects/project_1/browser-views/view%20%2F%201",
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
      "/api/projects/project%20%2F%201/browser-config",
      "/api/projects/project%20%2F%201/browser-config",
    ]);
    expect(fetch.mock.calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ expectedVersion: 0, payload });
  });
});
