import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createExperimentBrowserView,
  deleteExperimentBrowserView,
  getExperimentBrowserDetail,
  listExperimentBrowserRows,
  listExperimentBrowserViews,
  updateExperimentBrowserView,
} from "../data/experimentBrowserApi.js";
import { ExperimentColumnsDrawer } from "./ExperimentColumnsDrawer.jsx";
import { ExperimentCompareTray } from "./ExperimentCompareTray.jsx";
import { ExperimentDetailDrawer } from "./ExperimentDetailDrawer.jsx";

const PAGE_LIMIT = 200;
const ROW_HEIGHT = 42;
const VIEWPORT_HEIGHT = 504;
const OVERSCAN = 5;
const MAX_COMPARE_SELECTION = 12;
const EMPTY_SELECTION = [];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function errorMessage(error, fallback) {
  return error?.message || fallback;
}

function displayCell(row, column) {
  if (column.id === "experiment") return row.label;
  const cell = row.cells?.[column.id];
  if (!cell || cell.value == null || cell.value === "") return "-";
  const value = cell.formattedValue ?? cell.value;
  return `${value}${column.unit ? ` ${column.unit}` : ""}`;
}

function filterValue(column, value) {
  if (["number", "integer"].includes(column?.valueType)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (column?.valueType === "boolean") return String(value).toLowerCase() === "true";
  return value;
}

function defaultColumnSettings(columns) {
  return columns.map((column, order) => ({
    columnId: column.id,
    order,
    width: column.pinned ? 210 : 160,
    hidden: column.pinned ? false : !column.recommended,
  }));
}

function reconcileColumnSettings(columns, current) {
  const available = new Map(columns.map((column) => [column.id, column]));
  const retained = asArray(current)
    .filter((setting) => available.has(setting.columnId))
    .sort((left, right) => left.order - right.order)
    .map((setting) => ({
      ...setting,
      hidden: available.get(setting.columnId).pinned ? false : Boolean(setting.hidden),
      width: Number(setting.width) || (available.get(setting.columnId).pinned ? 210 : 160),
    }));
  const retainedIds = new Set(retained.map((setting) => setting.columnId));
  const appended = defaultColumnSettings(columns).filter((setting) => !retainedIds.has(setting.columnId));
  return [...retained, ...appended].map((setting, order) => ({ ...setting, order }));
}

function sameColumnIds(items, availableIds) {
  const filtered = asArray(items).filter((item) => availableIds.has(item.columnId));
  return filtered.length === asArray(items).length ? items : filtered;
}

function browserViewFromResponse(response) {
  return response?.browserView || response || null;
}

export function ExperimentBrowser({
  projectId,
  initialSelectedExperimentIds = EMPTY_SELECTION,
  onSelectionChange,
  onOpenImportReview,
  onOpenSourceRange,
  loadProjection = listExperimentBrowserRows,
  loadDetail = getExperimentBrowserDetail,
  listViews = listExperimentBrowserViews,
  createView = createExperimentBrowserView,
  updateView = updateExperimentBrowserView,
  deleteView = deleteExperimentBrowserView,
}) {
  const [columns, setColumns] = useState([]);
  const [columnSettings, setColumnSettings] = useState([]);
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState([]);
  const [sort, setSort] = useState([]);
  const [filterColumnId, setFilterColumnId] = useState("");
  const [filterOperator, setFilterOperator] = useState("contains");
  const [filterInput, setFilterInput] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialSelectedExperimentIds));
  const [summariesById, setSummariesById] = useState(() => new Map());
  const [scrollTop, setScrollTop] = useState(0);
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailCache, setDetailCache] = useState(() => new Map());
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState("");
  const [browserViews, setBrowserViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState("");
  const [viewName, setViewName] = useState("");
  const [viewLoading, setViewLoading] = useState(false);
  const [viewSaving, setViewSaving] = useState(false);
  const [viewError, setViewError] = useState("");
  const projectRef = useRef(projectId);
  const columnsTriggerRef = useRef(null);

  const updateSelection = useCallback((next) => {
    setSelectedIds(next);
    onSelectionChange?.([...next]);
  }, [onSelectionChange]);

  const applyView = useCallback((view) => {
    if (!view) return;
    const payload = view.payload || {};
    setActiveViewId(view.id || "");
    setViewName(view.name || "");
    setColumnSettings(asArray(payload.columns));
    setFilters(asArray(payload.filters));
    setSort(asArray(payload.sort));
    updateSelection(new Set(asArray(payload.selectedExperimentIds)));
    setCompareOpen(false);
    setViewError("");
  }, [updateSelection]);

  useEffect(() => {
    setSelectedIds(new Set(initialSelectedExperimentIds));
  }, [initialSelectedExperimentIds]);

  useEffect(() => {
    if (!projectId) {
      setBrowserViews([]);
      setViewLoading(false);
      return undefined;
    }
    let active = true;
    setViewLoading(true);
    setViewError("");
    listViews(projectId)
      .then((response) => {
        if (!active) return;
        const views = asArray(response?.browserViews ?? response);
        setBrowserViews(views);
        const defaultView = views.find((view) => view.isDefault);
        if (defaultView) applyView(defaultView);
      })
      .catch((requestError) => {
        if (active) setViewError(errorMessage(requestError, "Saved views could not be loaded."));
      })
      .finally(() => { if (active) setViewLoading(false); });
    return () => { active = false; };
  }, [applyView, listViews, projectId]);

  const fetchPage = useCallback(async (cursor, append, signal) => {
    append ? setLoadingMore(true) : setLoading(true);
    if (!append) setError("");
    try {
      const response = await loadProjection(projectId, {
        search,
        filters,
        sort,
        cursor: cursor || null,
        limit: PAGE_LIMIT,
      }, { signal });
      const responseColumns = asArray(response?.columns);
      const responseRows = asArray(response?.rows);
      setColumns(responseColumns);
      setRows((current) => append ? [...current, ...responseRows] : responseRows);
      setSummariesById((current) => {
        const next = new Map(current);
        responseRows.forEach((row) => next.set(row.experimentId, {
          experimentId: row.experimentId,
          label: row.label,
        }));
        return next;
      });
      setTotalCount(Number(response?.totalCount) || 0);
      setNextCursor(response?.nextCursor || null);
      if (!append) {
        setScrollTop(0);
        setColumnSettings((current) => reconcileColumnSettings(responseColumns, current));
        const availableIds = new Set(responseColumns.map((column) => column.id));
        setFilters((current) => sameColumnIds(current, availableIds));
        setSort((current) => sameColumnIds(current, availableIds));
      }
    } catch (requestError) {
      if (requestError?.name !== "AbortError") setError(errorMessage(requestError, "Experiment Browser could not be loaded."));
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }, [filters, loadProjection, projectId, search, sort]);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      setRows([]);
      setColumns([]);
      setTotalCount(0);
      return undefined;
    }
    if (projectRef.current !== projectId) {
      projectRef.current = projectId;
      setColumnSettings([]);
      setDetailId(null);
      setDetail(null);
      setDetailCache(new Map());
      setCompareOpen(false);
      setActiveViewId("");
      setViewName("");
    }
    const controller = new AbortController();
    fetchPage(null, false, controller.signal);
    return () => controller.abort();
  }, [fetchPage, projectId]);

  useEffect(() => {
    if (!detailId || !projectId) return undefined;
    const cached = detailCache.get(detailId);
    if (cached) {
      setDetail(cached);
      setDetailError("");
      setDetailLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    loadDetail(projectId, detailId, { signal: controller.signal })
      .then((response) => {
        setDetail(response);
        setDetailCache((current) => new Map(current).set(detailId, response));
      })
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") setDetailError(errorMessage(requestError, "Experiment detail could not be loaded."));
      })
      .finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [detailCache, detailId, loadDetail, projectId]);

  const visibleColumns = useMemo(() => {
    const columnsById = new Map(columns.map((column) => [column.id, column]));
    return [...columnSettings]
      .sort((left, right) => left.order - right.order)
      .filter((setting) => !setting.hidden && columnsById.has(setting.columnId))
      .map((setting) => ({ ...columnsById.get(setting.columnId), width: setting.width }));
  }, [columnSettings, columns]);
  const gridTemplateColumns = useMemo(() => (
    `42px ${visibleColumns.map((column) => `${column.width || (column.pinned ? 210 : 160)}px`).join(" ")}`
  ), [visibleColumns]);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleRowCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const virtualRows = rows.slice(startIndex, startIndex + visibleRowCount);
  const selectedColumn = columns.find((column) => column.id === filterColumnId);
  const selectedExperimentIds = useMemo(() => [...selectedIds], [selectedIds]);
  const selectedSummaries = useMemo(() => selectedExperimentIds.map((id) => (
    summariesById.get(id) || { experimentId: id, label: id }
  )), [selectedExperimentIds, summariesById]);
  const compareDetails = useMemo(() => selectedExperimentIds
    .map((id) => detailCache.get(id))
    .filter(Boolean), [detailCache, selectedExperimentIds]);
  const activeView = browserViews.find((view) => view.id === activeViewId) || null;

  const toggleSelection = (row) => {
    const next = new Set(selectedIds);
    if (next.has(row.experimentId)) {
      next.delete(row.experimentId);
    } else if (next.size < MAX_COMPARE_SELECTION) {
      next.add(row.experimentId);
      setSummariesById((current) => new Map(current).set(row.experimentId, {
        experimentId: row.experimentId,
        label: row.label,
      }));
    } else {
      setCompareError(`Select up to ${MAX_COMPARE_SELECTION} experiments for comparison.`);
      return;
    }
    if (!next.size) setCompareOpen(false);
    setCompareError("");
    updateSelection(next);
  };

  const removeSelection = (experimentId) => {
    const next = new Set(selectedIds);
    next.delete(experimentId);
    if (!next.size) setCompareOpen(false);
    updateSelection(next);
  };

  const clearSelection = () => {
    setCompareOpen(false);
    setCompareError("");
    updateSelection(new Set());
  };

  const openComparison = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setCompareOpen(true);
    setCompareError("");
    const missingIds = ids.filter((id) => !detailCache.has(id));
    if (!missingIds.length) return;
    const controller = new AbortController();
    setCompareLoading(true);
    try {
      const loaded = await Promise.all(missingIds.map((id) => loadDetail(projectId, id, { signal: controller.signal })));
      setDetailCache((current) => {
        const next = new Map(current);
        missingIds.forEach((id, index) => next.set(id, loaded[index]));
        return next;
      });
    } catch (requestError) {
      if (requestError?.name !== "AbortError") setCompareError(errorMessage(requestError, "Selected experiments could not be compared."));
    } finally {
      setCompareLoading(false);
    }
  };

  const applyFilter = () => {
    if (!filterColumnId) return;
    const valueOptional = ["is_empty", "not_empty"].includes(filterOperator);
    if (!valueOptional && !String(filterInput).trim()) return;
    setFilters([{
      columnId: filterColumnId,
      operator: filterOperator,
      value: valueOptional ? null : filterValue(selectedColumn, filterInput),
    }]);
  };

  const toggleSort = (columnId) => {
    setSort((current) => {
      const existing = current.find((item) => item.columnId === columnId);
      if (!existing) return [{ columnId, direction: "asc" }];
      if (existing.direction === "asc") return [{ columnId, direction: "desc" }];
      return [];
    });
  };

  const currentViewPayload = () => ({
    columns: columnSettings,
    filters,
    sort,
    groupBy: null,
    selectedExperimentIds: [...selectedIds],
  });

  const mergeSavedView = (savedView) => {
    if (!savedView) return;
    setBrowserViews((current) => {
      const withoutSaved = current.filter((view) => view.id !== savedView.id).map((view) => (
        savedView.isDefault ? { ...view, isDefault: false } : view
      ));
      return [savedView, ...withoutSaved];
    });
    setActiveViewId(savedView.id);
    setViewName(savedView.name);
  };

  const saveView = async () => {
    const name = viewName.trim();
    if (!name) {
      setViewError("Enter a view name before saving.");
      return;
    }
    setViewSaving(true);
    setViewError("");
    try {
      const response = activeViewId
        ? await updateView(projectId, activeViewId, { name, payload: currentViewPayload() })
        : await createView(projectId, { name, isDefault: false, payload: currentViewPayload() });
      mergeSavedView(browserViewFromResponse(response));
    } catch (requestError) {
      setViewError(errorMessage(requestError, "Browser view could not be saved."));
    } finally {
      setViewSaving(false);
    }
  };

  const renameView = async () => {
    const name = viewName.trim();
    if (!activeViewId || !name) return;
    setViewSaving(true);
    setViewError("");
    try {
      mergeSavedView(browserViewFromResponse(await updateView(projectId, activeViewId, { name })));
    } catch (requestError) {
      setViewError(errorMessage(requestError, "Browser view could not be renamed."));
    } finally {
      setViewSaving(false);
    }
  };

  const setDefaultView = async () => {
    if (!activeViewId) return;
    setViewSaving(true);
    setViewError("");
    try {
      mergeSavedView(browserViewFromResponse(await updateView(projectId, activeViewId, { isDefault: true })));
    } catch (requestError) {
      setViewError(errorMessage(requestError, "Default Browser view could not be changed."));
    } finally {
      setViewSaving(false);
    }
  };

  const removeView = async () => {
    if (!activeViewId) return;
    setViewSaving(true);
    setViewError("");
    try {
      await deleteView(projectId, activeViewId);
      setBrowserViews((current) => current.filter((view) => view.id !== activeViewId));
      setActiveViewId("");
      setViewName("");
    } catch (requestError) {
      setViewError(errorMessage(requestError, "Browser view could not be deleted."));
    } finally {
      setViewSaving(false);
    }
  };

  return (
    <div className={`experiment-browser-shell ${detailId ? "detail-open" : ""} ${selectedIds.size ? "comparison-selected" : ""}`}>
      <aside className="experiment-browser-sidebar">
        <div className="experiment-browser-sidebar-head">
          <span>Experiment Browser</span>
          <strong>{totalCount}</strong>
        </div>
        <form role="search" className="experiment-browser-search" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); }}>
          <label htmlFor="experiment-browser-search">Search experiments</label>
          <div className="experiment-browser-search-row">
            <input id="experiment-browser-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Label, value, alias..." />
            <button type="submit">Search</button>
          </div>
        </form>

        <section className="experiment-browser-filter">
          <h3>Filter</h3>
          <label htmlFor="experiment-browser-filter-column">Column</label>
          <select id="experiment-browser-filter-column" aria-label="Filter column" value={filterColumnId} onChange={(event) => setFilterColumnId(event.target.value)}>
            <option value="">Choose a column</option>
            {columns.map((column) => <option value={column.id} key={column.id}>{column.label}</option>)}
          </select>
          <label htmlFor="experiment-browser-filter-operator">Operator</label>
          <select id="experiment-browser-filter-operator" aria-label="Filter operator" value={filterOperator} onChange={(event) => setFilterOperator(event.target.value)}>
            <option value="contains">contains</option>
            <option value="eq">equals</option>
            <option value="gte">at least</option>
            <option value="lte">at most</option>
            <option value="gt">greater than</option>
            <option value="lt">less than</option>
            <option value="is_empty">is empty</option>
            <option value="not_empty">is not empty</option>
          </select>
          <label htmlFor="experiment-browser-filter-value">Value</label>
          <input id="experiment-browser-filter-value" aria-label="Filter value" value={filterInput} disabled={["is_empty", "not_empty"].includes(filterOperator)} onChange={(event) => setFilterInput(event.target.value)} />
          <div className="experiment-browser-filter-actions">
            <button type="button" onClick={applyFilter}>Apply filter</button>
            <button type="button" disabled={!filters.length} onClick={() => setFilters([])}>Clear</button>
          </div>
          {filters.map((filter) => (
            <div className="experiment-filter-chip" key={`${filter.columnId}-${filter.operator}`}>
              <span>{columns.find((column) => column.id === filter.columnId)?.label || filter.columnId}</span>
              <button type="button" aria-label="Remove filter" onClick={() => setFilters([])}>x</button>
            </div>
          ))}
        </section>
      </aside>

      <main className="experiment-browser-main">
        <header className="experiment-browser-toolbar">
          <div>
            <h1>Experiments</h1>
            <p>{rows.length} loaded of {totalCount} active experiment records</p>
          </div>
          <button ref={columnsTriggerRef} type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(true)}>Choose columns</button>
        </header>

        <section className="experiment-browser-viewbar" aria-label="Personal Browser views">
          <select
            aria-label="Saved view"
            value={activeViewId}
            disabled={viewLoading || viewSaving}
            onChange={(event) => {
              const nextId = event.target.value;
              if (!nextId) {
                setActiveViewId("");
                setViewName("");
                return;
              }
              applyView(browserViews.find((view) => view.id === nextId));
            }}
          >
            <option value="">Unsaved view</option>
            {browserViews.map((view) => <option value={view.id} key={view.id}>{view.name}{view.isDefault ? " (default)" : ""}</option>)}
          </select>
          <input aria-label="View name" value={viewName} maxLength={80} placeholder="View name" onChange={(event) => setViewName(event.target.value)} />
          <button type="button" disabled={viewSaving || !viewName.trim()} onClick={saveView}>{activeViewId ? "Update view" : "Save view"}</button>
          <button type="button" disabled={viewSaving || !activeViewId || !viewName.trim()} onClick={renameView}>Rename view</button>
          <button type="button" disabled={viewSaving || !activeViewId || activeView?.isDefault} onClick={setDefaultView}>Set default view</button>
          <button type="button" disabled={viewSaving || !activeViewId} onClick={removeView}>Delete view</button>
        </section>
        {viewError ? <div className="experiment-view-error" role="alert">{viewError}</div> : null}

        {error && <div className="browser-error" role="alert">{error}</div>}
        {loading && <div className="browser-status">Loading experiments...</div>}
        {!loading && !error && !rows.length && (
          <div className="experiment-browser-empty">
            <h2>No published experiments</h2>
            <p>Confirm workbook semantics and publish reviewed experiment records to populate this table.</p>
            {onOpenImportReview && <button type="button" onClick={onOpenImportReview}>Import workbook</button>}
          </div>
        )}
        {!loading && !error && rows.length > 0 && (
          <div className="experiment-grid-frame" role="table" aria-label="Cross-experiment data table">
            <div className="experiment-grid-header" role="row" style={{ gridTemplateColumns }}>
              <div role="columnheader" aria-label="Select experiments" />
              {visibleColumns.map((column) => {
                const activeSort = sort.find((item) => item.columnId === column.id);
                return (
                  <div
                    role="columnheader"
                    tabIndex={0}
                    key={column.id}
                    className={column.pinned ? "pinned" : ""}
                    onClick={() => toggleSort(column.id)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") toggleSort(column.id); }}
                  >
                    <span>{column.label}</span>
                    {activeSort && <small>{activeSort.direction}</small>}
                  </div>
                );
              })}
            </div>
            <div className="experiment-grid-viewport" style={{ height: VIEWPORT_HEIGHT }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
              <div className="experiment-grid-spacer" style={{ height: rows.length * ROW_HEIGHT }}>
                {virtualRows.map((row, visibleIndex) => {
                  const rowIndex = startIndex + visibleIndex;
                  return (
                    <div
                      role="row"
                      className={`experiment-grid-row ${selectedIds.has(row.experimentId) ? "selected" : ""}`}
                      key={row.experimentId}
                      style={{ gridTemplateColumns, height: ROW_HEIGHT, transform: `translateY(${rowIndex * ROW_HEIGHT}px)` }}
                    >
                      <div role="cell" className="experiment-select-cell">
                        <input type="checkbox" aria-label={`Select ${row.label}`} checked={selectedIds.has(row.experimentId)} onChange={() => toggleSelection(row)} />
                      </div>
                      {visibleColumns.map((column) => (
                        <div role="cell" className={column.pinned ? "pinned" : ""} key={column.id} title={displayCell(row, column)}>
                          {column.id === "experiment" ? (
                            <button type="button" className="experiment-row-link" aria-label={`Open ${row.label}`} onClick={() => setDetailId(row.experimentId)}>{row.label}</button>
                          ) : displayCell(row, column)}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {nextCursor && (
          <button type="button" className="experiment-load-more" disabled={loadingMore} onClick={() => fetchPage(nextCursor, true)}>
            {loadingMore ? "Loading more..." : "Load more experiments"}
          </button>
        )}
      </main>

      <ExperimentColumnsDrawer
        open={columnsOpen}
        columns={columns}
        settings={columnSettings}
        onChange={setColumnSettings}
        onReset={() => setColumnSettings(defaultColumnSettings(columns))}
        onClose={() => setColumnsOpen(false)}
        returnFocusRef={columnsTriggerRef}
      />

      <ExperimentCompareTray
        selectedExperimentIds={selectedExperimentIds}
        summaries={selectedSummaries}
        details={compareDetails}
        expanded={compareOpen}
        loading={compareLoading}
        error={compareError}
        onRemove={removeSelection}
        onClear={clearSelection}
        onOpen={openComparison}
        onClose={() => setCompareOpen(false)}
        onSourceClick={onOpenSourceRange}
      />

      {detailId && (
        <ExperimentDetailDrawer
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={() => { setDetailId(null); setDetail(null); setDetailError(""); }}
          onOpenSourceRange={onOpenSourceRange}
        />
      )}
    </div>
  );
}
