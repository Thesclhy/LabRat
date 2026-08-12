import React from "react";
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
    saveAnnotation: vi.fn(async (_projectId, experimentId, annotation) => ({
      experimentAnnotation: { experimentId, ...annotation, updatedAt: "2026-08-12T12:00:00.000Z" },
    })),
    deleteAnnotation: vi.fn(async () => ({ deleted: true })),
    createCustomColumn: vi.fn(async () => ({ experimentCustomColumn: { id: "custom_1", label: "Untitled column", version: 1 } })),
    updateCustomColumn: vi.fn(async (_projectId, customColumnId, changes) => ({ experimentCustomColumn: { id: customColumnId, label: changes.label, version: changes.expectedVersion + 1 } })),
    deleteCustomColumn: vi.fn(async () => ({ deleted: true })),
    saveCustomValue: vi.fn(async (_projectId, customColumnId, experimentId, changes) => ({ experimentCustomValue: { customColumnId, experimentId, value: changes.value, version: 1 } })),
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

  it("stars, annotates, colors, filters, and unstars experiments through the existing rows", async () => {
    const api = viewApi();
    const loadProjection = vi.fn(async (_projectId, query = {}) => (
      query.starredOnly
        ? projection({ rows: [{ ...rows[0], annotation: { note: "Follow up", color: "purple" } }] })
        : projection()
    ));
    render(<ExperimentBrowser projectId="project_1" loadProjection={loadProjection} loadDetail={vi.fn()} {...api} />);

    await screen.findByText("Exp 1");
    fireEvent.click(screen.getByRole("button", { name: "Star Exp 1" }));
    const popover = screen.getByRole("dialog", { name: "Annotation for Exp 1" });
    fireEvent.change(within(popover).getByPlaceholderText("Why does this experiment matter?"), { target: { value: "Follow up" } });
    fireEvent.click(within(popover).getByRole("radio", { name: "purple" }));
    fireEvent.click(within(popover).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveAnnotation).toHaveBeenCalledWith("project_1", "exp_1", { note: "Follow up", color: "purple" }));
    const starredButton = await screen.findByRole("button", { name: "Edit star for Exp 1" });
    expect(starredButton.title).toBe("Follow up");
    expect(screen.getByRole("row", { name: /Exp 1/ }).className).toContain("annotation-purple");

    fireEvent.click(screen.getByRole("checkbox", { name: "Starred only" }));
    await waitFor(() => expect(loadProjection).toHaveBeenLastCalledWith("project_1", expect.objectContaining({ starredOnly: true }), expect.anything()));
    fireEvent.click(await screen.findByRole("button", { name: "Edit star for Exp 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Unstar" }));
    await waitFor(() => expect(api.deleteAnnotation).toHaveBeenCalledWith("project_1", "exp_1"));
    expect(screen.queryByText("Exp 1")).toBeNull();
  });

  it("shows every column on first visit and supports column visibility, search, filtering, and sorting", async () => {
    const loadProjection = vi.fn(async () => projection());
    render(<ExperimentBrowser projectId="project_1" loadProjection={loadProjection} loadDetail={vi.fn()} {...viewApi()} />);

    expect(await screen.findByText("Exp 1")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Temperature/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Yield/ })).toBeTruthy();
    expect(screen.queryByText("sort")).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose columns" })).toBeNull();

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /Yield/ }), { clientX: 320, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    expect(screen.queryByRole("columnheader", { name: /Yield/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yield (percent)" }));
    expect(screen.getByRole("columnheader", { name: /Yield/ })).toBeTruthy();

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

  it("highlights every visible case-insensitive match after search results load", async () => {
    const matchingRows = [{
      ...rows[0],
      label: "Exp 48",
      cells: {
        ...rows[0].cells,
        "field:yield:percent:number": { value: 48.4, formattedValue: "48.4", confidence: 0.9, warningCount: 0 },
      },
    }];
    const loadProjection = vi.fn(async () => projection({ rows: matchingRows }));
    render(<ExperimentBrowser projectId="project_1" loadProjection={loadProjection} loadDetail={vi.fn()} {...viewApi()} />);

    await screen.findByText("Exp 48");
    fireEvent.change(screen.getByLabelText("Search experiments"), { target: { value: "48" } });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => expect(loadProjection).toHaveBeenLastCalledWith(
      "project_1",
      expect.objectContaining({ search: "48" }),
      expect.anything(),
    ));
    await waitFor(() => expect(document.querySelectorAll("mark.experiment-search-match")).toHaveLength(2));
    expect([...document.querySelectorAll("mark.experiment-search-match")].map((match) => match.textContent)).toEqual(["48", "48"]);
  });

  it("adds, edits, renames, hides, restores, and deletes a shared custom column", async () => {
    const api = viewApi();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ExperimentBrowser projectId="project_1" loadProjection={vi.fn(async () => projection())} loadDetail={vi.fn()} {...api} />);

    await screen.findByText("Exp 1");
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    const customHeader = await screen.findByRole("columnheader", { name: /Untitled column/ });
    expect(api.createCustomColumn).toHaveBeenCalledWith("project_1", "Untitled column");

    const customCell = screen.getByRole("row", { name: /Exp 1/ }).querySelector(".experiment-custom-cell-value");
    fireEvent.doubleClick(customCell);
    const cellInput = screen.getByRole("textbox", { name: "Edit Untitled column for Exp 1" });
    fireEvent.change(cellInput, { target: { value: "Needs repeat 48" } });
    fireEvent.keyDown(cellInput, { key: "Enter" });
    await waitFor(() => expect(api.saveCustomValue).toHaveBeenCalledWith("project_1", "custom_1", "exp_1", { value: "Needs repeat 48", expectedVersion: 0 }));
    expect(await screen.findByText("Needs repeat 48")).toBeTruthy();

    fireEvent.doubleClick(screen.getByText("Needs repeat 48"));
    const cancelInput = screen.getByRole("textbox", { name: "Edit Untitled column for Exp 1" });
    fireEvent.change(cancelInput, { target: { value: "Do not save" } });
    fireEvent.keyDown(cancelInput, { key: "Escape" });
    expect(screen.getByText("Needs repeat 48")).toBeTruthy();
    expect(api.saveCustomValue).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(screen.getByText("Needs repeat 48"));
    const blankInput = screen.getByRole("textbox", { name: "Edit Untitled column for Exp 1" });
    fireEvent.change(blankInput, { target: { value: "" } });
    fireEvent.blur(blankInput);
    await waitFor(() => expect(api.saveCustomValue).toHaveBeenLastCalledWith("project_1", "custom_1", "exp_1", { value: "", expectedVersion: 1 }));

    fireEvent.doubleClick(customHeader);
    const headerInput = screen.getByRole("textbox", { name: "Rename Untitled column" });
    fireEvent.change(headerInput, { target: { value: "Decision" } });
    fireEvent.keyDown(headerInput, { key: "Enter" });
    expect(await screen.findByRole("columnheader", { name: /Decision/ })).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /Decision/ }), { clientX: 300, clientY: 80 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    expect(screen.queryByRole("columnheader", { name: /Decision/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Decision" }));
    const restored = screen.getByRole("columnheader", { name: /Decision/ });
    fireEvent.contextMenu(restored, { clientX: 300, clientY: 80 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete column" }));
    await waitFor(() => expect(api.deleteCustomColumn).toHaveBeenCalledWith("project_1", "custom_1"));
    expect(screen.queryByRole("columnheader", { name: /Decision/ })).toBeNull();
    window.confirm.mockRestore();
  });

  it("opens full experiment detail from the row without rendering comparison checkboxes", async () => {
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

    const row = await screen.findByRole("row", { name: /Exp 1/ });
    expect(within(row).queryByRole("checkbox")).toBeNull();

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

    await waitFor(() => expect(document.querySelector(".experiment-grid-viewport")?.style.width).toBe("632px"));

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

  it("orders Browser toolbar actions consistently with matching standard styles", async () => {
    render(
      <ExperimentBrowser
        projectId="project_1"
        loadProjection={vi.fn(async () => projection())}
        loadDetail={vi.fn()}
        onOpenImportReview={vi.fn()}
        onRequestDataChange={vi.fn()}
        {...viewApi()}
      />,
    );
    await screen.findByText("Exp 1");
    const actions = document.querySelector(".experiment-browser-toolbar-actions");
    expect(within(actions).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Import workbook",
      "Add or update data",
      "Add column",
    ]);
    within(actions).getAllByRole("button").forEach((button) => expect(button.className).not.toContain("primary-action"));
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

    expect(screen.queryByText("deleted:column")).toBeNull();

    fireEvent.click(screen.getByRole("columnheader", { name: /Yield/ }));
    await waitFor(() => expect(api.saveSharedConfig).toHaveBeenCalledWith("project_1", expect.objectContaining({
      expectedVersion: 4,
      payload: expect.objectContaining({ sort: [] }),
    })));
  });

});
