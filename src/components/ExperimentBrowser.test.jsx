import React, { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExperimentBrowser } from "./ExperimentBrowser.jsx";

const columns = [
  { id: "experiment", label: "Experiment", pinned: true, recommended: true, valueType: "string", unit: null },
  { id: "field:temperature:degC:number", label: "Temperature (degC)", recommended: true, valueType: "number", unit: "degC" },
  { id: "field:yield:percent:number", label: "Yield (percent)", recommended: false, valueType: "number", unit: "percent" },
];

const rows = [{
  experimentId: "exp_1",
  label: "Exp 1",
  cells: {
    "field:temperature:degC:number": { value: 250, formattedValue: "250", confidence: 0.91, warningCount: 0 },
    "field:yield:percent:number": { value: 44.1, formattedValue: "44.1", confidence: 0.9, warningCount: 0 },
  },
  seriesInventory: [{ seriesKey: "rate", label: "Rate", pointCount: 2 }],
  warningCount: 0,
  sourceRanges: [{ sourceDocumentId: "source_1", sheet: "Runs", range: "A1:D4" }],
}];

function projection(overrides = {}) {
  return { schemaVersion: "labrat.experimentProjection.v1", columns, rows, totalCount: 1, nextCursor: null, ...overrides };
}

function viewApi(overrides = {}) {
  return {
    listViews: vi.fn(async () => ({ browserViews: [] })),
    createView: vi.fn(async (_projectId, request) => ({ browserView: { id: "view_1", ...request } })),
    updateView: vi.fn(async (_projectId, id, request) => ({ browserView: { id, name: "Saved view", isDefault: false, payload: {}, ...request } })),
    deleteView: vi.fn(async () => ({ deleted: true })),
    ...overrides,
  };
}

describe("ExperimentBrowser", () => {
  it("assigns horizontal scrolling only to the shared grid frame", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const frameRule = css.match(/\.experiment-grid-frame\s*\{([^}]*)\}/)?.[1] || "";
    const viewportRule = css.match(/\.experiment-grid-viewport\s*\{([^}]*)\}/)?.[1] || "";
    const mainRule = css.match(/\.experiment-browser-main\s*\{([^}]*)\}/)?.[1] || "";
    const headerCellRule = css.match(/\.experiment-grid-header\s*>\s*\[role="columnheader"\]\s*\{([^}]*)\}/)?.[1] || "";
    const headerLabelContainerRule = css.match(/\.experiment-grid-header-label\s*\{([^}]*)\}/)?.[1] || "";
    const headerLabelRule = css.match(/\.experiment-grid-header-label\s*>\s*span:last-child\s*\{([^}]*)\}/)?.[1] || "";
    const sortDirectionRule = css.match(/\.experiment-sort-direction\s*\{([^}]*)\}/)?.[1] || "";
    const cellValueRule = css.match(/\.experiment-grid-cell-value\s*\{([^}]*)\}/)?.[1] || "";

    expect(frameRule).toMatch(/overflow-x:\s*auto/);
    expect(frameRule).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\)/);
    expect(viewportRule).toMatch(/overflow-x:\s*clip/);
    expect(viewportRule).toMatch(/overflow-y:\s*auto/);
    expect(mainRule).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
    expect(headerCellRule).toMatch(/font-size:\s*12px/);
    expect(headerLabelContainerRule).toMatch(/flex:\s*1 1 100%/);
    expect(headerLabelContainerRule).toMatch(/width:\s*100%/);
    expect(headerLabelRule).toMatch(/white-space:\s*normal/);
    expect(sortDirectionRule).toMatch(/position:\s*absolute/);
    expect(cellValueRule).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("shows every column on first visit and supports column visibility, search, filtering, and sorting", async () => {
    const loadProjection = vi.fn(async () => projection());
    render(<ExperimentBrowser projectId="project_1" loadProjection={loadProjection} loadDetail={vi.fn()} {...viewApi()} />);

    expect(await screen.findByText("Exp 1")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Temperature/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Yield/ })).toBeTruthy();
    expect(screen.queryByText("sort")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Yield (percent)" }));
    expect(screen.queryByRole("columnheader", { name: /Yield/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Yield (percent)" }));
    expect(screen.getByRole("columnheader", { name: /Yield/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    fireEvent.change(screen.getByLabelText("Search experiments"), { target: { value: "Exp 7" } });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(loadProjection).toHaveBeenLastCalledWith("project_1", expect.objectContaining({ search: "Exp 7" }), expect.anything()));

    fireEvent.change(screen.getByLabelText("Filter column"), { target: { value: "field:temperature:degC:number" } });
    fireEvent.change(screen.getByLabelText("Filter operator"), { target: { value: "gte" } });
    fireEvent.change(screen.getByLabelText("Filter value"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    await waitFor(() => expect(loadProjection).toHaveBeenLastCalledWith("project_1", expect.objectContaining({
      filters: [{ columnId: "field:temperature:degC:number", operator: "gte", value: 250 }],
    }), expect.anything()));

    fireEvent.click(screen.getByRole("columnheader", { name: /Temperature/ }));
    await waitFor(() => expect(loadProjection).toHaveBeenLastCalledWith("project_1", expect.objectContaining({
      sort: [{ columnId: "field:temperature:degC:number", direction: "asc" }],
    }), expect.anything()));
  });

  it("selects rows and loads full experiment detail only when a row is opened", async () => {
    const loadDetail = vi.fn(async () => ({
      experiment: { id: "exp_1", canonicalLabel: "Exp 1", aliases: [] },
      dataSnapshot: { id: "snapshot_1" },
      record: { fields: [], series: [], warnings: [], sourceRefs: [] },
    }));
    const onSelectionChange = vi.fn();
    render(
      <ExperimentBrowser
        projectId="project_1"
        loadProjection={vi.fn(async () => projection())}
        loadDetail={loadDetail}
        onSelectionChange={onSelectionChange}
        {...viewApi()}
      />,
    );

    const row = await screen.findByRole("row", { name: /Exp 1/ });
    fireEvent.click(within(row).getByRole("checkbox", { name: "Select Exp 1" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(["exp_1"]);
    expect(loadDetail).not.toHaveBeenCalled();

    fireEvent.click(within(row).getByRole("button", { name: "Open Exp 1" }));
    await waitFor(() => expect(loadDetail).toHaveBeenCalledWith("project_1", "exp_1", expect.anything()));
    expect(await screen.findByRole("complementary", { name: "Experiment detail" })).toBeTruthy();
  });

  it("uses main-style direct column controls and opens detail from the full row", async () => {
    const loadDetail = vi.fn(async () => ({
      experiment: { id: "exp_1", canonicalLabel: "Exp 1", aliases: [] },
      dataSnapshot: { id: "snapshot_1" },
      record: { fields: [], series: [], warnings: [], sourceRefs: [] },
    }));
    render(
      <ExperimentBrowser
        projectId="project_1"
        loadProjection={vi.fn(async () => projection())}
        loadDetail={loadDetail}
        {...viewApi()}
      />,
    );

    const temperatureHeader = await screen.findByRole("columnheader", { name: /Temperature/ });
    expect(document.querySelector(".experiment-grid-viewport")?.style.width).toBe("572px");
    expect(document.querySelector(".experiment-grid-viewport")?.style.height).toBe("");
    expect(document.querySelector(".experiment-grid-viewport")?.style.minWidth).toBe("100%");
    fireEvent.contextMenu(temperatureHeader, { clientX: 180, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    expect(screen.queryByRole("columnheader", { name: /Temperature/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Temperature (degC)" }));
    const restoredHeader = screen.getByRole("columnheader", { name: /Temperature/ });
    const resizeHandle = within(restoredHeader).getByRole("separator", { name: "Resize Temperature (degC)" });
    fireEvent.mouseDown(resizeHandle, { clientX: 160 });
    fireEvent.mouseMove(window, { clientX: 220 });
    fireEvent.mouseUp(window);

    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    expect(screen.getByRole("spinbutton", { name: "Width for Temperature (degC)" }).value).toBe("220");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    const yieldHeader = screen.getByRole("columnheader", { name: /Yield/ });
    fireEvent.contextMenu(yieldHeader, { clientX: 320, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Move left" }));
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "",
      expect.stringContaining("Experiment"),
      expect.stringContaining("Yield"),
      expect.stringContaining("Temperature"),
    ]);

    const dataTransfer = { effectAllowed: "", setData: vi.fn() };
    fireEvent.dragStart(within(yieldHeader).getByText("Yield (percent)"), { dataTransfer });
    await waitFor(() => expect(yieldHeader.className).toContain("is-dragging"));
    fireEvent.dragOver(restoredHeader, { clientX: 1, dataTransfer });
    await waitFor(() => expect(restoredHeader.className).toContain("drop-after"));
    fireEvent.drop(restoredHeader, { dataTransfer });
    fireEvent.dragEnd(within(yieldHeader).getByText("Yield (percent)"), { dataTransfer });
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "",
      expect.stringContaining("Experiment"),
      expect.stringContaining("Temperature"),
      expect.stringContaining("Yield"),
    ]);

    fireEvent.click(screen.getByRole("row", { name: /Exp 1/ }));
    await waitFor(() => expect(loadDetail).toHaveBeenCalledWith("project_1", "exp_1", expect.anything()));
  });

  it("shows an actionable empty state and loads additional cursor pages", async () => {
    const onOpenImportReview = vi.fn();
    const loadProjection = vi.fn()
      .mockResolvedValueOnce(projection({ rows: [], totalCount: 0, nextCursor: null }))
      .mockResolvedValueOnce(projection({ nextCursor: "next_1" }))
      .mockResolvedValueOnce(projection({ rows: [{ ...rows[0], experimentId: "exp_2", label: "Exp 2" }], nextCursor: null }));
    const { rerender } = render(
      <ExperimentBrowser projectId="project_1" loadProjection={loadProjection} loadDetail={vi.fn()} onOpenImportReview={onOpenImportReview} {...viewApi()} />,
    );
    expect(await screen.findByText("No published experiments")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import workbook" }));
    expect(onOpenImportReview).toHaveBeenCalledTimes(1);

    rerender(<ExperimentBrowser projectId="project_2" loadProjection={loadProjection} loadDetail={vi.fn()} {...viewApi()} />);
    expect(await screen.findByText("Exp 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more experiments" }));
    expect(await screen.findByText("Exp 2")).toBeTruthy();
    expect(loadProjection).toHaveBeenLastCalledWith("project_2", expect.objectContaining({ cursor: "next_1" }), expect.anything());
  });

  it("loads a default personal view, prunes stale columns, and saves, renames, and defaults it", async () => {
    const savedView = {
      id: "view_1",
      name: "High temperature",
      isDefault: true,
      payload: {
        columns: [
          { columnId: "experiment", order: 0, width: 240, hidden: false },
          { columnId: "field:yield:percent:number", order: 1, width: 190, hidden: false },
          { columnId: "deleted:column", order: 2, width: 100, hidden: false },
        ],
        filters: [{ columnId: "field:temperature:degC:number", operator: "gte", value: 250 }],
        sort: [{ columnId: "field:yield:percent:number", direction: "desc" }],
        groupBy: null,
        selectedExperimentIds: ["exp_1"],
      },
    };
    const api = viewApi({ listViews: vi.fn(async () => ({ browserViews: [savedView] })) });
    const loadProjection = vi.fn(async () => projection());
    render(<ExperimentBrowser projectId="project_1" loadProjection={loadProjection} loadDetail={vi.fn()} {...api} />);

    expect(await screen.findByRole("columnheader", { name: /Yield/ })).toBeTruthy();
    await waitFor(() => expect(loadProjection).toHaveBeenLastCalledWith("project_1", expect.objectContaining({
      filters: savedView.payload.filters,
      sort: savedView.payload.sort,
    }), expect.anything()));
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    expect(screen.queryByText("deleted:column")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Renamed screen" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename view" }));
    await waitFor(() => expect(api.updateView).toHaveBeenCalledWith("project_1", "view_1", { name: "Renamed screen" }));
    fireEvent.click(screen.getByRole("button", { name: "Set default view" }));
    await waitFor(() => expect(api.updateView).toHaveBeenCalledWith("project_1", "view_1", { isDefault: true }));
    fireEvent.click(screen.getByRole("button", { name: "Update view" }));
    await waitFor(() => expect(api.updateView).toHaveBeenLastCalledWith("project_1", "view_1", expect.objectContaining({
      payload: expect.objectContaining({ selectedExperimentIds: ["exp_1"] }),
    })));
  });

  it("opens a post-publication view without auto-selecting its experiments", async () => {
    const publishedView = {
      id: "published_view",
      name: "Published experiments",
      isDefault: false,
      payload: {
        columns: [],
        filters: [],
        sort: [],
        groupBy: null,
        selectedExperimentIds: ["exp_1"],
      },
    };
    const api = viewApi({
      listViews: vi.fn(async () => ({ browserViews: [publishedView] })),
    });

    render(
      <ExperimentBrowser
        projectId="project_1"
        initialViewId={publishedView.id}
        suppressInitialViewSelection
        loadProjection={vi.fn(async () => projection())}
        loadDetail={vi.fn()}
        {...api}
      />,
    );

    expect(await screen.findByText("Exp 1")).toBeTruthy();
    expect(screen.getByLabelText("Saved view").value).toBe(publishedView.id);
    expect(screen.queryByText("1 selected")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select Exp 1" }).checked).toBe(false);

    fireEvent.change(screen.getByLabelText("Saved view"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Saved view"), { target: { value: publishedView.id } });
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("keeps comparison selection across search changes and lazily loads selected details", async () => {
    const loadProjection = vi.fn(async () => projection());
    const loadDetail = vi.fn(async (_projectId, experimentId) => ({
      experiment: { id: experimentId, canonicalLabel: "Exp 1" },
      dataSnapshot: { id: "snapshot_1" },
      record: {
        fields: [{ fieldKey: "temperature", displayName: "Temperature", valueType: "number", value: 250, formattedValue: "250", unit: "degC" }],
        series: [{ seriesKey: "rate", label: "Rate", points: [{ x: 0, y: 1 }] }],
        warnings: [],
        sourceRefs: [{ sourceDocumentId: "source_1", sheet: "Runs", range: "A1:D4" }],
      },
    }));
    render(<ExperimentBrowser projectId="project_1" loadProjection={loadProjection} loadDetail={loadDetail} {...viewApi()} />);

    const row = await screen.findByRole("row", { name: /Exp 1/ });
    fireEvent.click(within(row).getByRole("checkbox", { name: "Select Exp 1" }));
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(loadDetail).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Search experiments"), { target: { value: "hidden by query" } });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(loadProjection).toHaveBeenLastCalledWith("project_1", expect.objectContaining({ search: "hidden by query" }), expect.anything()));
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Compare selected experiments" }));
    await waitFor(() => expect(loadDetail).toHaveBeenCalledWith("project_1", "exp_1", expect.anything()));
    const comparison = await screen.findByRole("region", { name: "Experiment comparison" });
    expect(within(comparison).getByRole("columnheader", { name: "Temperature (degC)" })).toBeTruthy();
  });

  it("does not echo controlled initial selection back to the parent during render", async () => {
    const onSelectionChange = vi.fn();
    function Harness() {
      const [selection, setSelection] = useState(["exp_1"]);
      return (
        <ExperimentBrowser
          projectId="project_1"
          initialSelectedExperimentIds={selection}
          onSelectionChange={(next) => {
            onSelectionChange(next);
            setSelection(next);
          }}
          loadProjection={vi.fn(async () => projection())}
          loadDetail={vi.fn()}
          {...viewApi()}
        />
      );
    }
    render(<Harness />);

    expect(await screen.findByText("1 selected")).toBeTruthy();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});
