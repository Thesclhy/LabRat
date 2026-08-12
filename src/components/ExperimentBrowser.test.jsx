import React, { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExperimentBrowser } from "./ExperimentBrowser.jsx";

const columns = [
  { id: "experiment", label: "Experiment", pinned: false, recommended: true, valueType: "string", unit: null },
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
    loadSharedConfig: vi.fn(async () => ({ projectBrowserConfig: null, canEdit: true })),
    saveSharedConfig: vi.fn(async (_projectId, request) => ({
      projectBrowserConfig: { id: "config_1", version: request.expectedVersion + 1, payload: request.payload },
      canEdit: true,
    })),
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

  it("keeps the mounted grid and its scroll positions while a header sort refreshes rows", async () => {
    let resolveRefresh;
    const scrollableRows = Array.from({ length: 30 }, (_, index) => ({
      ...rows[0],
      experimentId: `exp_${index + 1}`,
      label: `Exp ${index + 1}`,
    }));
    const scrollableProjection = projection({ rows: scrollableRows, totalCount: scrollableRows.length });
    const loadProjection = vi.fn()
      .mockResolvedValueOnce(scrollableProjection)
      .mockImplementationOnce(() => new Promise((resolvePromise) => { resolveRefresh = resolvePromise; }));
    render(<ExperimentBrowser projectId="project_1" loadProjection={loadProjection} loadDetail={vi.fn()} {...viewApi()} />);

    const temperatureHeader = await screen.findByRole("columnheader", { name: /Temperature/ });
    const frame = screen.getByRole("table", { name: "Cross-experiment data table" });
    const viewport = document.querySelector(".experiment-grid-viewport");
    frame.scrollLeft = 240;
    viewport.scrollTop = 84;
    fireEvent.scroll(viewport);

    fireEvent.click(temperatureHeader);
    await waitFor(() => expect(loadProjection).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("table", { name: "Cross-experiment data table" })).toBe(frame);
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(frame.scrollLeft).toBe(240);
    expect(viewport.scrollTop).toBe(84);

    resolveRefresh(scrollableProjection);
    await waitFor(() => expect(frame.getAttribute("aria-busy")).toBe("false"));
    expect(screen.getByRole("table", { name: "Cross-experiment data table" })).toBe(frame);
    expect(frame.scrollLeft).toBe(240);
    expect(viewport.scrollTop).toBe(84);
  });

  it("autosaves shared layout changes without flashing transient save text", async () => {
    let resolveSave;
    const api = viewApi({
      saveSharedConfig: vi.fn(() => new Promise((resolvePromise) => { resolveSave = resolvePromise; })),
    });
    render(<ExperimentBrowser projectId="project_1" loadProjection={vi.fn(async () => projection())} loadDetail={vi.fn()} {...api} />);

    const temperatureHeader = await screen.findByRole("columnheader", { name: /Temperature/ });
    fireEvent.click(temperatureHeader);
    await waitFor(() => expect(api.saveSharedConfig).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Saving layout…")).toBeNull();

    const request = api.saveSharedConfig.mock.calls[0][1];
    resolveSave({
      projectBrowserConfig: { id: "config_1", version: 1, payload: request.payload },
      canEdit: true,
    });
    await waitFor(() => expect(screen.queryByText("Saving layout…")).toBeNull());
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

  it("renames and reorders the Experiment column through the existing header controls", async () => {
    const api = viewApi();
    render(
      <ExperimentBrowser
        projectId="project_1"
        loadProjection={vi.fn(async () => projection())}
        loadDetail={vi.fn()}
        {...api}
      />,
    );

    const experimentHeader = await screen.findByRole("columnheader", { name: /Experiment/ });
    fireEvent.contextMenu(experimentHeader, { clientX: 180, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename column" }));
    let renameInput = screen.getByRole("textbox", { name: "Rename Experiment" });
    fireEvent.change(renameInput, { target: { value: "Cancelled name" } });
    fireEvent.keyDown(renameInput, { key: "Escape" });
    expect(screen.getByRole("columnheader", { name: /Experiment/ })).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /Experiment/ }), { clientX: 180, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename column" }));
    renameInput = screen.getByRole("textbox", { name: "Rename Experiment" });
    fireEvent.change(renameInput, { target: { value: "Run" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    expect(screen.getByRole("columnheader", { name: /Run/ })).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /Run/ }), { clientX: 180, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename column" }));
    renameInput = screen.getByRole("textbox", { name: "Rename Run" });
    fireEvent.change(renameInput, { target: { value: "" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    expect(screen.getByRole("columnheader", { name: /Experiment/ })).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /Experiment/ }), { clientX: 180, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename column" }));
    renameInput = screen.getByRole("textbox", { name: "Rename Experiment" });
    fireEvent.change(renameInput, { target: { value: "Run" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /Run/ }), { clientX: 180, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Move right" }));
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "",
      expect.stringContaining("Temperature"),
      expect.stringContaining("Run"),
      expect.stringContaining("Yield"),
    ]);

    await waitFor(() => expect(api.saveSharedConfig).toHaveBeenCalledWith("project_1", expect.objectContaining({
      payload: expect.objectContaining({
        columns: expect.arrayContaining([expect.objectContaining({ columnId: "experiment", labelOverride: "Run", order: 1 })]),
      }),
    })));
  });

  it("shows shared settings to viewers without exposing editing controls", async () => {
    const api = viewApi({
      loadSharedConfig: vi.fn(async () => ({
        projectBrowserConfig: {
          id: "config_1",
          version: 2,
          payload: {
            columns: columns.map((column, order) => ({ columnId: column.id, order, width: 160, hidden: false })),
            filters: [],
            sort: [],
          },
        },
        canEdit: false,
      })),
    });
    render(<ExperimentBrowser projectId="project_1" loadProjection={vi.fn(async () => projection())} loadDetail={vi.fn()} {...api} />);

    const experimentHeader = await screen.findByRole("columnheader", { name: /Experiment/ });
    expect(within(experimentHeader).queryByRole("separator")).toBeNull();
    fireEvent.contextMenu(experimentHeader, { clientX: 180, clientY: 90 });
    expect(screen.getByRole("menuitem", { name: "Rename column" }).disabled).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Hide column" }).disabled).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Auto-fit width" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Apply filter" }).disabled).toBe(true);
    expect(api.saveSharedConfig).not.toHaveBeenCalled();
  });

  it("shows an actionable empty state and loads additional cursor pages", async () => {
    const onOpenImportReview = vi.fn();
    const loadProjection = vi.fn(async (projectId, query = {}) => {
      if (projectId === "project_1") return projection({ rows: [], totalCount: 0, nextCursor: null });
      if (query.cursor === "next_1") {
        return projection({ rows: [{ ...rows[0], experimentId: "exp_2", label: "Exp 2" }], nextCursor: null });
      }
      return projection({ nextCursor: "next_1" });
    });
    const api = viewApi();
    const loadDetail = vi.fn();
    const { rerender } = render(
      <ExperimentBrowser projectId="project_1" loadProjection={loadProjection} loadDetail={loadDetail} onOpenImportReview={onOpenImportReview} {...api} />,
    );
    expect(await screen.findByText("No published experiments")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import workbook" }));
    expect(onOpenImportReview).toHaveBeenCalledTimes(1);

    rerender(<ExperimentBrowser projectId="project_2" loadProjection={loadProjection} loadDetail={loadDetail} {...api} />);
    expect(await screen.findByText("Exp 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more experiments" }));
    expect(await screen.findByText("Exp 2")).toBeTruthy();
    expect(loadProjection).toHaveBeenLastCalledWith("project_2", expect.objectContaining({ cursor: "next_1" }), expect.anything());
  });

  it("loads shared project configuration, prunes stale columns, and persists display changes", async () => {
    const sharedConfig = {
      id: "config_1",
      version: 4,
      payload: {
        columns: [
          { columnId: "experiment", order: 0, width: 240, hidden: false },
          { columnId: "field:yield:percent:number", order: 1, width: 190, hidden: false },
          { columnId: "deleted:column", order: 2, width: 100, hidden: false },
        ],
        filters: [{ columnId: "field:temperature:degC:number", operator: "gte", value: 250 }],
        sort: [{ columnId: "field:yield:percent:number", direction: "desc" }],
      },
    };
    const api = viewApi({ loadSharedConfig: vi.fn(async () => ({ projectBrowserConfig: sharedConfig, canEdit: true })) });
    const loadProjection = vi.fn(async () => projection());
    render(<ExperimentBrowser projectId="project_1" loadProjection={loadProjection} loadDetail={vi.fn()} {...api} />);

    expect(await screen.findByRole("columnheader", { name: /Yield/ })).toBeTruthy();
    await waitFor(() => expect(loadProjection).toHaveBeenLastCalledWith("project_1", expect.objectContaining({
      filters: sharedConfig.payload.filters,
      sort: sharedConfig.payload.sort,
    }), expect.anything()));
    expect(screen.queryByText("1 selected")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    expect(screen.queryByText("deleted:column")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    fireEvent.click(screen.getByRole("columnheader", { name: /Yield/ }));
    await waitFor(() => expect(api.saveSharedConfig).toHaveBeenCalledWith("project_1", expect.objectContaining({
      expectedVersion: 4,
      payload: expect.objectContaining({ sort: [] }),
    })));
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
