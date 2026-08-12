import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getExperimentBrowserDetail,
  getProjectBrowserConfig,
  listExperimentBrowserRows,
  updateProjectBrowserConfig,
} from "../data/experimentBrowserApi.js";
import { ExperimentColumnsDrawer } from "./ExperimentColumnsDrawer.jsx";
import { ExperimentCompareTray } from "./ExperimentCompareTray.jsx";
import { ExperimentDetailDrawer } from "./ExperimentDetailDrawer.jsx";
import { ExperimentGridHeaderCell } from "./ExperimentGridHeaderCell.jsx";

const PAGE_LIMIT = 200;
const ROW_HEIGHT = 42;
const DEFAULT_VIEWPORT_HEIGHT = 504;
const OVERSCAN = 5;
const MAX_COMPARE_SELECTION = 12;
const EMPTY_SELECTION = [];
const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 800;

function defaultWidth(column) {
  return column.id === "experiment" ? 210 : 160;
}

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
    width: defaultWidth(column),
    hidden: false,
  }));
}

function reconcileColumnSettings(columns, current) {
  const available = new Map(columns.map((column) => [column.id, column]));
  const retained = asArray(current)
    .filter((setting) => available.has(setting.columnId))
    .sort((left, right) => left.order - right.order)
    .map((setting) => ({
      ...setting,
      hidden: Boolean(setting.hidden),
      width: Number(setting.width) || defaultWidth(available.get(setting.columnId)),
    }));
  const retainedIds = new Set(retained.map((setting) => setting.columnId));
  const appended = defaultColumnSettings(columns).filter((setting) => !retainedIds.has(setting.columnId));
  return [...retained, ...appended].map((setting, order) => ({ ...setting, order }));
}

function sameColumnIds(items, availableIds) {
  const filtered = asArray(items).filter((item) => availableIds.has(item.columnId));
  return filtered.length === asArray(items).length ? items : filtered;
}

function orderedColumnSettings(settings) {
  return [...asArray(settings)].sort((left, right) => left.order - right.order);
}

function normalizeColumnOrder(settings) {
  return settings.map((setting, order) => ({ ...setting, order }));
}

function autoFitColumnWidth(column, rows) {
  const values = asArray(rows).slice(0, PAGE_LIMIT).map((row) => displayCell(row, column));
  const longest = Math.max(column.label?.length || 0, ...values.map((value) => String(value).length));
  return Math.min(360, Math.max(column.id === "experiment" ? 150 : 90, longest * 7 + 34));
}

export function ExperimentBrowser({
  projectId,
  initialSelectedExperimentIds = EMPTY_SELECTION,
  onSelectionChange,
  onOpenImportReview,
  onRequestDataChange,
  onOpenSourceRange,
  loadProjection = listExperimentBrowserRows,
  loadDetail = getExperimentBrowserDetail,
  loadSharedConfig = getProjectBrowserConfig,
  saveSharedConfig = updateProjectBrowserConfig,
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
  const [viewLoading, setViewLoading] = useState(false);
  const [viewSaving, setViewSaving] = useState(false);
  const [viewError, setViewError] = useState("");
  const [sharedConfigVersion, setSharedConfigVersion] = useState(0);
  const [sharedConfigLoaded, setSharedConfigLoaded] = useState(false);
  const [canEditSharedConfig, setCanEditSharedConfig] = useState(false);
  const [dragColumnId, setDragColumnId] = useState("");
  const [dropTarget, setDropTarget] = useState(null);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
  const viewportHeightRef = useRef(DEFAULT_VIEWPORT_HEIGHT);
  const projectRef = useRef(projectId);
  const columnsTriggerRef = useRef(null);
  const gridViewportRef = useRef(null);
  const lastSavedPayloadRef = useRef("");

  const updateSelection = useCallback((next) => {
    setSelectedIds(next);
    onSelectionChange?.([...next]);
  }, [onSelectionChange]);

  useEffect(() => {
    setSelectedIds(new Set(initialSelectedExperimentIds));
  }, [initialSelectedExperimentIds]);

  useEffect(() => {
    if (!projectId) {
      setSharedConfigLoaded(false);
      setViewLoading(false);
      return undefined;
    }
    setSharedConfigLoaded(false);
    let active = true;
    setViewLoading(true);
    setViewError("");
    loadSharedConfig(projectId)
      .then((response) => {
        if (!active) return;
        const config = response?.projectBrowserConfig || null;
        const payload = config?.payload || { columns: [], filters: [], sort: [] };
        if (config) {
          setColumnSettings(asArray(payload.columns));
          setFilters(asArray(payload.filters));
          setSort(asArray(payload.sort));
        }
        setSharedConfigVersion(Number(config?.version) || 0);
        setCanEditSharedConfig(Boolean(response?.canEdit));
        lastSavedPayloadRef.current = JSON.stringify(payload);
        setSharedConfigLoaded(true);
      })
      .catch((requestError) => {
        if (active) {
          setViewError(errorMessage(requestError, "Shared Browser configuration could not be loaded."));
          setSharedConfigLoaded(true);
        }
      })
      .finally(() => { if (active) setViewLoading(false); });
    return () => { active = false; };
  }, [loadSharedConfig, projectId]);

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
        const maximumScrollTop = Math.max(0, responseRows.length * ROW_HEIGHT - viewportHeightRef.current);
        setScrollTop((current) => Math.min(current, maximumScrollTop));
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
      setScrollTop(0);
      setSharedConfigLoaded(false);
      return undefined;
    }
    if (!sharedConfigLoaded) return undefined;
    const controller = new AbortController();
    fetchPage(null, false, controller.signal);
    return () => controller.abort();
  }, [fetchPage, projectId, sharedConfigLoaded]);

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

  const displayColumns = useMemo(() => {
    const settingsById = new Map(columnSettings.map((setting) => [setting.columnId, setting]));
    return columns.map((column) => ({
      ...column,
      originalLabel: column.label,
      label: settingsById.get(column.id)?.labelOverride || column.label,
    }));
  }, [columnSettings, columns]);
  const visibleColumns = useMemo(() => {
    const columnsById = new Map(displayColumns.map((column) => [column.id, column]));
    return orderedColumnSettings(columnSettings)
      .filter((setting) => !setting.hidden && columnsById.has(setting.columnId))
      .map((setting) => ({ ...columnsById.get(setting.columnId), width: setting.width }));
  }, [columnSettings, displayColumns]);
  const hiddenColumns = useMemo(() => {
    const columnsById = new Map(displayColumns.map((column) => [column.id, column]));
    return orderedColumnSettings(columnSettings)
      .filter((setting) => setting.hidden && columnsById.has(setting.columnId))
      .map((setting) => columnsById.get(setting.columnId));
  }, [columnSettings, displayColumns]);
  const gridTemplateColumns = useMemo(() => (
    `42px ${visibleColumns.map((column) => `${column.width || defaultWidth(column)}px`).join(" ")}`
  ), [visibleColumns]);
  const gridWidth = useMemo(() => (
    42 + visibleColumns.reduce((total, column) => total + (column.width || defaultWidth(column)), 0)
  ), [visibleColumns]);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleRowCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const virtualRows = rows.slice(startIndex, startIndex + visibleRowCount);
  const selectedColumn = columns.find((column) => column.id === filterColumnId);
  const selectedExperimentIds = useMemo(() => [...selectedIds], [selectedIds]);
  const selectedSummaries = useMemo(() => selectedExperimentIds.map((id) => (
    summariesById.get(id) || { experimentId: id, label: id }
  )), [selectedExperimentIds, summariesById]);
  const compareDetails = useMemo(() => selectedExperimentIds
    .map((id) => detailCache.get(id))
    .filter(Boolean), [detailCache, selectedExperimentIds]);
  useEffect(() => {
    if (!projectId || !sharedConfigLoaded || !canEditSharedConfig || !columnSettings.length || viewSaving) return undefined;
    const payload = { columns: columnSettings, filters, sort };
    const serialized = JSON.stringify(payload);
    if (serialized === lastSavedPayloadRef.current) return undefined;
    const timer = window.setTimeout(() => {
      setViewSaving(true);
      setViewError("");
      saveSharedConfig(projectId, { expectedVersion: sharedConfigVersion, payload })
        .then((response) => {
          const saved = response?.projectBrowserConfig;
          if (!saved) return;
          setSharedConfigVersion(Number(saved.version) || sharedConfigVersion + 1);
          lastSavedPayloadRef.current = JSON.stringify(saved.payload || payload);
        })
        .catch(async (requestError) => {
          if (requestError?.status === 409 || requestError?.statusCode === 409) {
            try {
              const latest = await loadSharedConfig(projectId);
              const config = latest?.projectBrowserConfig;
              if (config) {
                setColumnSettings(asArray(config.payload?.columns));
                setFilters(asArray(config.payload?.filters));
                setSort(asArray(config.payload?.sort));
                setSharedConfigVersion(Number(config.version) || 0);
                lastSavedPayloadRef.current = JSON.stringify(config.payload || {});
              }
              setViewError("The shared Browser layout changed in another session. The latest project layout was loaded.");
            } catch (reloadError) {
              setViewError(errorMessage(reloadError, "The latest shared Browser layout could not be loaded."));
            }
          } else {
            setViewError(errorMessage(requestError, "Shared Browser configuration could not be saved."));
          }
        })
        .finally(() => setViewSaving(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [canEditSharedConfig, columnSettings, filters, loadSharedConfig, projectId, saveSharedConfig, sharedConfigLoaded, sharedConfigVersion, sort, viewSaving]);

  useEffect(() => {
    const viewport = gridViewportRef.current;
    if (!viewport) return undefined;
    const updateViewportHeight = () => {
      const measuredHeight = Math.round(viewport.getBoundingClientRect().height);
      if (measuredHeight <= 0) return;
      const nextHeight = Math.max(ROW_HEIGHT, measuredHeight);
      viewportHeightRef.current = nextHeight;
      setViewportHeight((current) => current === nextHeight ? current : nextHeight);
    };
    updateViewportHeight();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportHeight);
      return () => window.removeEventListener("resize", updateViewportHeight);
    }
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [rows.length]);

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
    if (!canEditSharedConfig) return;
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

  const patchColumnSetting = (columnId, patch) => {
    if (!canEditSharedConfig) return;
    setColumnSettings((current) => current.map((setting) => (
      setting.columnId === columnId ? { ...setting, ...patch } : setting
    )));
  };

  const moveColumn = (columnId, direction) => {
    if (!canEditSharedConfig) return;
    setColumnSettings((current) => {
      const ordered = orderedColumnSettings(current);
      const visible = ordered.filter((setting) => !setting.hidden);
      const index = visible.findIndex((setting) => setting.columnId === columnId);
      const target = visible[index + direction];
      if (index < 0 || !target) return current;
      const sourceIndex = ordered.findIndex((setting) => setting.columnId === columnId);
      const [source] = ordered.splice(sourceIndex, 1);
      const targetIndex = ordered.findIndex((setting) => setting.columnId === target.columnId);
      ordered.splice(targetIndex + (direction > 0 ? 1 : 0), 0, source);
      return normalizeColumnOrder(ordered);
    });
  };

  const reorderColumn = () => {
    if (!canEditSharedConfig) return;
    if (!dragColumnId || !dropTarget || dragColumnId === dropTarget.columnId) {
      setDragColumnId("");
      setDropTarget(null);
      return;
    }
    setColumnSettings((current) => {
      const ordered = orderedColumnSettings(current);
      const sourceIndex = ordered.findIndex((setting) => setting.columnId === dragColumnId);
      if (sourceIndex < 0) return current;
      const [source] = ordered.splice(sourceIndex, 1);
      const targetIndex = ordered.findIndex((setting) => setting.columnId === dropTarget.columnId);
      if (targetIndex < 0) return current;
      ordered.splice(targetIndex + (dropTarget.before ? 0 : 1), 0, source);
      return normalizeColumnOrder(ordered);
    });
    setDragColumnId("");
    setDropTarget(null);
  };

  return (
    <div className={`experiment-browser-shell ${detailId ? "detail-open" : ""} ${selectedIds.size ? "comparison-selected" : ""}`}>
      <aside className="experiment-browser-sidebar">
        <div className="experiment-browser-sidebar-head">
          <span>Experiment Browser</span>
          <strong>{totalCount}</strong>
        </div>

        <section className="experiment-browser-sidebar-section" aria-label="Shared Browser layout">
          <h3>Shared layout</h3>
          <p className="browser-muted">{canEditSharedConfig ? "Changes save for everyone in this project." : "Project editors control this shared layout."}</p>
          {viewError ? <div className="experiment-view-error" role="alert">{viewError}</div> : null}
        </section>

        <form role="search" className="experiment-browser-search" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); }}>
          <h3>Search</h3>
          <label className="sr-only" htmlFor="experiment-browser-search">Search experiments</label>
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
            {displayColumns.map((column) => <option value={column.id} key={column.id}>{column.label}</option>)}
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
            <button type="button" disabled={!canEditSharedConfig} onClick={applyFilter}>Apply filter</button>
            <button type="button" disabled={!canEditSharedConfig || !filters.length} onClick={() => setFilters([])}>Clear</button>
          </div>
          {filters.map((filter) => (
            <div className="experiment-filter-chip" key={`${filter.columnId}-${filter.operator}`}>
              <span>{displayColumns.find((column) => column.id === filter.columnId)?.label || filter.columnId}</span>
              <button type="button" disabled={!canEditSharedConfig} aria-label="Remove filter" onClick={() => setFilters([])}>x</button>
            </div>
          ))}
        </section>

        <section className="experiment-browser-sidebar-section">
          <h3>Hidden columns</h3>
          {hiddenColumns.length ? (
            <div className="experiment-browser-hidden-columns">
              {hiddenColumns.map((column) => (
                <button
                  type="button"
                  className="chip hidden-column-chip"
                  key={column.id}
                  title={`Show ${column.label}`}
                  disabled={!canEditSharedConfig}
                  onClick={() => patchColumnSetting(column.id, { hidden: false })}
                >
                  {column.label} <span aria-hidden="true">+</span>
                </button>
              ))}
            </div>
          ) : <p className="browser-muted">Right-click a table header to hide it.</p>}
        </section>
      </aside>

      <main className="experiment-browser-main">
        <header className="experiment-browser-toolbar">
          <div>
            <h1>Experiment Browser</h1>
            <p>{rows.length} loaded of {totalCount} accepted experiment records. Click a row for source-backed detail.</p>
          </div>
          <div className="experiment-browser-toolbar-actions">
            {onRequestDataChange ? (
              <button type="button" className="primary-action" onClick={onRequestDataChange}>
                Add or update data
              </button>
            ) : null}
            {onOpenImportReview ? <button type="button" className="primary-action" onClick={onOpenImportReview}>Import workbook</button> : null}
            <button ref={columnsTriggerRef} type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(true)}>Choose columns</button>
          </div>
        </header>

        {error && <div className="browser-error" role="alert">{error}</div>}
        {(loading || viewLoading) && !rows.length && <div className="browser-status">Loading experiments...</div>}
        {!loading && !viewLoading && !error && !rows.length && (
          <div className="experiment-browser-empty">
            <h2>No published experiments</h2>
            <p>Confirm workbook semantics and publish reviewed experiment records to populate this table.</p>
          </div>
        )}
        {!viewLoading && !error && rows.length > 0 && (
          <div
            className={`experiment-grid-frame ${loading ? "is-refreshing" : ""}`}
            role="table"
            aria-label="Cross-experiment data table"
            aria-busy={loading ? "true" : "false"}
          >
            <div className="experiment-grid-header" role="row" style={{ gridTemplateColumns, width: gridWidth, minWidth: "100%" }}>
              <div role="columnheader" aria-label="Select experiments" />
              {visibleColumns.map((column, index) => {
                const activeSort = sort.find((item) => item.columnId === column.id);
                return (
                  <ExperimentGridHeaderCell
                    key={column.id}
                    column={column}
                    width={column.width}
                    sortDirection={activeSort?.direction || null}
                    draggable={canEditSharedConfig}
                    editable={canEditSharedConfig}
                    dragging={dragColumnId === column.id}
                    dropEdge={dropTarget?.columnId === column.id ? (dropTarget.before ? "before" : "after") : null}
                    canMoveLeft={canEditSharedConfig && index > 0}
                    canMoveRight={canEditSharedConfig && index < visibleColumns.length - 1}
                    onSort={() => { if (canEditSharedConfig) toggleSort(column.id); }}
                    onHide={() => patchColumnSetting(column.id, { hidden: true })}
                    onRename={(labelOverride) => patchColumnSetting(column.id, { labelOverride })}
                    onResize={(width) => patchColumnSetting(column.id, { width: Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)) })}
                    onAutoFit={() => patchColumnSetting(column.id, { width: autoFitColumnWidth(column, rows) })}
                    onMove={(direction) => moveColumn(column.id, direction)}
                    onDragStart={() => setDragColumnId(column.id)}
                    onDragOver={(before) => {
                      if (dragColumnId && dragColumnId !== column.id) setDropTarget({ columnId: column.id, before });
                    }}
                    onDrop={reorderColumn}
                    onDragEnd={() => { setDragColumnId(""); setDropTarget(null); }}
                  />
                );
              })}
            </div>
            <div
              ref={gridViewportRef}
              className="experiment-grid-viewport"
              style={{ width: gridWidth, minWidth: "100%" }}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div className="experiment-grid-spacer" style={{ height: rows.length * ROW_HEIGHT }}>
                {virtualRows.map((row, visibleIndex) => {
                  const rowIndex = startIndex + visibleIndex;
                  return (
                    <div
                      role="row"
                      className={`experiment-grid-row ${selectedIds.has(row.experimentId) ? "selected" : ""}`}
                      key={row.experimentId}
                      tabIndex={0}
                      style={{ gridTemplateColumns, height: ROW_HEIGHT, transform: `translateY(${rowIndex * ROW_HEIGHT}px)` }}
                      onClick={() => setDetailId(row.experimentId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setDetailId(row.experimentId);
                      }}
                    >
                      <div role="cell" className="experiment-select-cell">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.label}`}
                          checked={selectedIds.has(row.experimentId)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => toggleSelection(row)}
                        />
                      </div>
                      {visibleColumns.map((column) => (
                        <div role="cell" key={column.id} title={displayCell(row, column)}>
                          {column.id === "experiment" ? (
                            <button type="button" className="experiment-row-link" aria-label={`Open ${row.label}`} onClick={(event) => { event.stopPropagation(); setDetailId(row.experimentId); }}>{row.label}</button>
                          ) : <span className="experiment-grid-cell-value">{displayCell(row, column)}</span>}
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
        columns={displayColumns}
        settings={columnSettings}
        onChange={canEditSharedConfig ? setColumnSettings : undefined}
        readOnly={!canEditSharedConfig}
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
