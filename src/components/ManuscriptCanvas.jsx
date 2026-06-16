import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { COLORS, chartTypes } from "../charts/constants";
import { applyChartLayout, defaultChartLayout, defaultFontFamily, defaultPlotAreaForLayout, patchChartLayout, resolveChartLayout, scaleChartLayout } from "../charts/chartLayout";
import { chartSpecToProposal, experimentOptionsForChartSpec, makeGenericChartPreview } from "../charts/genericChartPreview";
import { Plot } from "../charts/Plot";
import { buildAcceptedMappingColumns, buildGenericBrowserRows } from "../data/experimentBrowserRows.js";
import { exportManuscriptPagesToPptx } from "../export/pptxExport";
import { experimentDateSortValue } from "../utils/date";
import { fmt, uid } from "../utils/format";
import { SelectionFrame } from "./SelectionFrame";
import { useManuscriptHistory } from "./useManuscriptHistory";

const fontOptions = [
  [defaultFontFamily, "System sans"],
  ["Arial, Helvetica, sans-serif", "Arial"],
  ["Georgia, 'Times New Roman', serif", "Georgia"],
  ["'Times New Roman', Times, serif", "Times New Roman"],
  ["'Courier New', Courier, monospace", "Courier New"],
];

const CANVAS_WIDTH = 1100;
const LEGACY_PAGE_WIDTH = 1100;
const LEGACY_PAGE_HEIGHT = 1600;
const LANDSCAPE_PAGE_WIDTH = 1600;
const LANDSCAPE_PAGE_HEIGHT = 900;
const PORTRAIT_PAGE_WIDTH = 900;
const PORTRAIT_PAGE_HEIGHT = 1600;
const EMPTY_CANVAS_HEIGHT = 520;
const DEFAULT_TEXT_FILL = "#ffffff";
const DEFAULT_TEXT_BORDER = "#cbd5e1";
const DEFAULT_TEXT_COLOR = "#1e293b";
const MIN_FONT_SIZE = 1;
const MAX_FONT_SIZE = 180;
const SELECTION_MODE = {
  NONE: "none",
  EDITOR_ACTIVE: "editor-active",
  TOOLBAR_PREVIEW: "toolbar-preview",
  RESTORING: "restoring-selection",
};
const TOOLBAR_TRANSITION = {
  RESTORE: "restore-selection",
  HANDOFF: "toolbar-handoff",
  BLOCK_SWITCH: "block-switch",
};

export function ManuscriptCanvas({ dataset, blocks, setBlocks, staged, setStaged, references, chartTemplates, setChartTemplates, chartSpecs, pages, setPages, canvasHeight, setCanvasHeight, pageOrientationPreference, setPageOrientationPreference, onSelectedChartContextChange, onRequestChartAnalysis, onSaveProject }) {
  const [selected, setSelected] = useState(null);
  const [editingTextBoxId, setEditingTextBoxId] = useState(null);
  const [textToolbarState, setTextToolbarState] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [chartContextMenu, setChartContextMenu] = useState(null);
  const [blockContextMenu, setBlockContextMenu] = useState(null);
  const [pageContextMenu, setPageContextMenu] = useState(null);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [orientationChoiceRequest, setOrientationChoiceRequest] = useState(null);
  const [chartDraft, setChartDraft] = useState(null);
  const [dismissedChartAssistId, setDismissedChartAssistId] = useState(null);
  const canvasWrapRef = useRef(null);
  const imageInputRef = useRef(null);
  const imageInsertPointRef = useRef(null);
  const richTextApiRef = useRef(null);
  const toolbarControlControllerRef = useRef(null);
  const textEditSessionRef = useRef(null);
  const experiments = useMemo(() => (Array.isArray(dataset?.experiments) ? dataset.experiments : []), [dataset?.experiments]);
  const genericImports = useMemo(() => (Array.isArray(dataset?.genericImports) ? dataset.genericImports : []), [dataset?.genericImports]);
  const safeChartSpecs = useMemo(() => normalizeChartSpecs(chartSpecs), [chartSpecs]);
  const safeBlocks = useMemo(() => normalizeManuscriptBlocks(blocks), [blocks]);
  const safeStaged = Array.isArray(staged) ? staged : [];
  const safeReferences = Array.isArray(references) ? references : [];
  const safeChartTemplates = normalizeChartTemplates(chartTemplates);
  const requiredCanvasHeight = canvasHeightForBlocks(safeBlocks);
  const hasStoredPages = Array.isArray(pages) && pages.length > 0;
  const legacyBlankCanvas = !safeBlocks.length && (isBlankLegacyAutoPage(pages) || (!Array.isArray(pages) && Number(canvasHeight) === LEGACY_PAGE_HEIGHT));
  const normalizedCanvasHeight = (!safeBlocks.length && !hasStoredPages) || legacyBlankCanvas ? 0 : Number(canvasHeight) || 0;
  const safePages = useMemo(() => normalizeManuscriptPages(pages, safeBlocks), [pages, safeBlocks]);
  const inferredPageOrientation = inferPageOrientation(safePages);
  const lockedPageOrientation = normalizePageOrientation(pageOrientationPreference) || inferredPageOrientation;
  const effectiveCanvasHeight = manuscriptHeight(safePages, normalizedCanvasHeight, requiredCanvasHeight);
  const effectiveCanvasWidth = manuscriptWidth(safePages, safeBlocks);
  const visibleCanvasHeight = Math.max(effectiveCanvasHeight, EMPTY_CANVAS_HEIGHT);
  const selectedBlockId = selected?.split(":")[0];
  const selectedChartComponent = selected?.includes(":");
  const selectedBlock = safeBlocks.find((block) => block.id === selectedBlockId);
  const activeTextBlock = selectedBlock?.kind === "text" ? selectedBlock : null;
  const inspectorOpen = !!selectedBlock;
  const chartAssistBlock = !selectedChartComponent && selectedBlock?.kind === "chart" && selectedBlock.id !== dismissedChartAssistId ? selectedBlock : null;
  const logoSrc = `${import.meta.env.BASE_URL}labrat-logo.png`;
  const closeContextMenu = () => setContextMenu(null);
  const closeChartContextMenu = () => setChartContextMenu(null);
  const closeBlockContextMenu = () => setBlockContextMenu(null);
  const closePageContextMenu = () => setPageContextMenu(null);
  const closeFloatingMenus = () => {
    closeContextMenu();
    closeChartContextMenu();
    closeBlockContextMenu();
    closePageContextMenu();
  };
  const manuscriptSnapshot = () => ({
    blocks: clone(safeBlocks),
    pages: clone(safePages),
    canvasHeight: effectiveCanvasHeight,
    pageOrientationPreference: pageOrientationPreference || null,
  });
  const applyManuscriptSnapshot = (snapshot) => {
    if (!snapshot) return;
    setBlocks(Array.isArray(snapshot.blocks) ? clone(snapshot.blocks) : []);
    setPages?.(Array.isArray(snapshot.pages) ? clone(snapshot.pages) : []);
    setCanvasHeight?.(Number(snapshot.canvasHeight) || 0);
    setPageOrientationPreference?.(normalizePageOrientation(snapshot.pageOrientationPreference));
    setEditingTextBoxId(null);
    setTextToolbarState(null);
    richTextApiRef.current = null;
    toolbarControlControllerRef.current = null;
    clearTextEditTimer();
    textEditSessionRef.current = null;
  };
  const { history: manuscriptHistory, canUndo, canRedo } = useManuscriptHistory({
    captureSnapshot: manuscriptSnapshot,
    applySnapshot: applyManuscriptSnapshot,
  });
  const clearTextEditTimer = () => {
    if (textEditSessionRef.current?.timer) {
      window.clearTimeout(textEditSessionRef.current.timer);
      textEditSessionRef.current.timer = null;
    }
  };
  const flushTextForNonTextMutation = () => {
    if (textEditSessionRef.current) {
      commitTextEditSession();
      return;
    }
    manuscriptHistory.flushActiveTransaction();
  };
  const beginHistoryTransaction = (type, meta = null) => {
    flushTextForNonTextMutation();
    manuscriptHistory.beginTransaction(type, meta);
  };
  const commitHistoryTransaction = () => manuscriptHistory.commitTransaction();
  const beginTextEditSession = (blockId) => {
    const existing = textEditSessionRef.current;
    if (existing?.blockId === blockId) return existing;
    if (existing) commitTextEditSession();
    manuscriptHistory.beginTransaction("text-edit", { blockId });
    const block = safeBlocks.find((item) => item.id === blockId);
    const startTextRuns = normalizeTextRuns(block?.textRuns, block);
    const session = {
      blockId,
      startTextRuns,
      latestTextRuns: startTextRuns,
      dirty: false,
      timer: null,
    };
    textEditSessionRef.current = session;
    return session;
  };
  const updateTextEditSession = (blockId, textRuns) => {
    const session = beginTextEditSession(blockId);
    const block = safeBlocks.find((item) => item.id === blockId);
    const latestTextRuns = normalizeTextRuns(textRuns, block);
    session.latestTextRuns = latestTextRuns;
    session.dirty = !textRunsEqual(session.startTextRuns, latestTextRuns);
    if (session.dirty) manuscriptHistory.markDirty();
    return session;
  };
  const scheduleTextEditCommit = () => {
    const session = textEditSessionRef.current;
    if (!session) return;
    clearTextEditTimer();
    session.timer = window.setTimeout(() => {
      commitTextEditSession();
    }, 850);
  };
  const commitTextEditSession = () => {
    const session = textEditSessionRef.current;
    if (!session) return false;
    clearTextEditTimer();
    const changed = session.dirty && !textRunsEqual(session.startTextRuns, session.latestTextRuns);
    textEditSessionRef.current = null;
    if (!changed) {
      manuscriptHistory.cancelTransaction();
      return false;
    }
    manuscriptHistory.commitTransaction();
    return true;
  };
  const undoManuscript = () => {
    commitTextEditSession();
    manuscriptHistory.undo();
  };
  const redoManuscript = () => {
    commitTextEditSession();
    manuscriptHistory.redo();
  };
  const patchBlock = (id, patch, options = {}) => {
    const historyMode = options.history || "immediate";
    const transactionType = options.transactionType || "block-update";
    if (historyMode === "immediate") {
      flushTextForNonTextMutation();
      manuscriptHistory.runImmediateTransaction(transactionType, () => {
        setBlocks((b) => (Array.isArray(b) ? b : []).map((x) => x.id === id ? { ...x, ...patch } : x));
      });
      return;
    }
    if (historyMode === "defer") {
      manuscriptHistory.markDirty();
      setBlocks((b) => (Array.isArray(b) ? b : []).map((x) => x.id === id ? { ...x, ...patch } : x));
      return;
    }
    setBlocks((b) => (Array.isArray(b) ? b : []).map((x) => x.id === id ? { ...x, ...patch } : x));
  };
  const patchTextRuns = (id, textRuns, options = {}) => {
    const historyMode = options.history || "commit";
    const transactionType = options.transactionType || "text-edit";
    const existingSession = textEditSessionRef.current;
    if (transactionType !== "text-edit") {
      if (existingSession) commitTextEditSession();
      const block = safeBlocks.find((item) => item.id === id);
      const normalizedTextRuns = normalizeTextRuns(textRuns, block);
      if (textRunsEqual(normalizeTextRuns(block?.textRuns, block), normalizedTextRuns)) return null;
      manuscriptHistory.beginTransaction(transactionType, { blockId: id });
      manuscriptHistory.markDirty();
      setBlocks((b) => (Array.isArray(b) ? b : []).map((x) => {
        if (x.id !== id) return x;
        return { ...x, textRuns: normalizedTextRuns, html: plainTextFromTextRuns(normalizedTextRuns) };
      }));
      manuscriptHistory.commitTransaction();
      return null;
    }
    if (historyMode === "commit" && existingSession?.dirty) {
      commitTextEditSession();
    }
    const session = updateTextEditSession(id, textRuns);
    setBlocks((b) => (Array.isArray(b) ? b : []).map((x) => {
      if (x.id !== id) return x;
      const normalizedTextRuns = normalizeTextRuns(textRuns, x);
      return { ...x, textRuns: normalizedTextRuns, html: plainTextFromTextRuns(normalizedTextRuns) };
    }));
    if (historyMode === "batch") {
      scheduleTextEditCommit();
    } else {
      commitTextEditSession();
    }
    return session;
  };
  const returnToWholeChartMode = () => {
    commitTextEditSession();
    if (selectedChartComponent) setSelected(selectedBlockId);
  };
  const requestPageAction = (action) => {
    if (lockedPageOrientation) {
      runPageAction(action, lockedPageOrientation);
      return;
    }
    setOrientationChoiceRequest(action);
  };
  const choosePageOrientation = (orientation) => {
    const nextOrientation = normalizePageOrientation(orientation) || "landscape";
    const action = orientationChoiceRequest || { type: "append" };
    setPageOrientationPreference?.(nextOrientation);
    setOrientationChoiceRequest(null);
    runPageAction(action, nextOrientation);
  };
  const runPageAction = (action, orientation) => {
    if (action?.type === "insert") {
      addPageAtY(action.y, orientation);
    } else {
      appendPage(orientation);
    }
  };
  const appendPage = (orientation) => {
    flushTextForNonTextMutation();
    manuscriptHistory.runImmediateTransaction("page-add", () => {
      const y = effectiveCanvasHeight;
      const page = createPage(safePages.length, y, orientation);
      const nextPages = [...safePages, page];
      setPages?.(nextPages);
      setCanvasHeight?.(y + page.height);
    });
    closeContextMenu();
  };
  const insertPageAtY = (insertY) => {
    requestPageAction({ type: "insert", y: insertY });
  };
  const addPageAtY = (insertY, orientation) => {
    flushTextForNonTextMutation();
    const safeInsertY = Math.max(0, Number(insertY) || 0);
    const nextPages = [...safePages];
    const insertedPage = createPage(safePages.length, safeInsertY, orientation);
    const shift = insertedPage.height;
    manuscriptHistory.runImmediateTransaction("page-add", () => {
      setBlocks((current) => (Array.isArray(current) ? current : []).map((block) => {
        const y = Number(block?.y) || 0;
        return y >= safeInsertY ? { ...block, y: y + shift } : block;
      }));
      const shiftedPages = shiftPagesFromY(nextPages, safeInsertY, shift);
      setPages?.([...shiftedPages, insertedPage].sort((a, b) => (a.y || 0) - (b.y || 0)));
      setCanvasHeight?.(effectiveCanvasHeight + shift);
    });
    closePageContextMenu();
  };
  const deletePageAt = (index) => {
    const page = safePages[index];
    if (!page) return;
    const pageTop = page.y;
    const pageBottom = page.y + page.height;
    const currentBlocks = safeBlocks;
    const crossing = currentBlocks.filter((block) => {
      const top = Number(block?.y) || 0;
      const bottom = top + (Number(block?.h) || 0);
      return top < pageBottom && bottom > pageTop && !(top >= pageTop && bottom <= pageBottom);
    });
    if (crossing.length) {
      window.alert("Move or resize blocks that cross this page boundary before deleting the page.");
      closePageContextMenu();
      return;
    }
    const contained = currentBlocks.filter((block) => {
      const top = Number(block?.y) || 0;
      const bottom = top + (Number(block?.h) || 0);
      return top >= pageTop && bottom <= pageBottom;
    });
    if (contained.length && !window.confirm(`Delete Page ${index + 1} and ${contained.length} block${contained.length === 1 ? "" : "s"} on it?`)) {
      closePageContextMenu();
      return;
    }
    flushTextForNonTextMutation();
    const containedIds = new Set(contained.map((block) => block.id));
    manuscriptHistory.runImmediateTransaction("page-delete", () => {
      setBlocks((current) => (Array.isArray(current) ? current : [])
        .filter((block) => !containedIds.has(block.id))
        .map((block) => {
          const y = Number(block?.y) || 0;
          return y >= pageBottom ? { ...block, y: y - page.height } : block;
        }));
      setPages?.(shiftPagesFromY(safePages.filter((_, pageIndex) => pageIndex !== index), pageBottom, -page.height));
      setCanvasHeight?.(Math.max(0, effectiveCanvasHeight - page.height));
    });
    if (containedIds.has(selectedBlockId)) setSelected(null);
    if (containedIds.has(editingTextBoxId)) setEditingTextBoxId(null);
    closePageContextMenu();
  };
  const insertionPointForBox = (point, width, height, fallback) => {
    const requestedX = point?.x ?? fallback.x;
    const requestedY = point?.y ?? fallback.y;
    const page = safePages.find((candidate) => {
      const top = Number(candidate.y) || 0;
      const bottom = top + (Number(candidate.height) || 0);
      return requestedY >= top && requestedY <= bottom;
    }) || safePages[0];
    if (!page) {
      return { x: Math.max(0, requestedX), y: Math.max(0, requestedY) };
    }
    const pageTop = Number(page.y) || 0;
    const pageWidth = Math.max(1, Number(page.width) || CANVAS_WIDTH);
    const pageHeight = Math.max(1, Number(page.height) || LEGACY_PAGE_HEIGHT);
    return {
      x: clampNumber(requestedX, 0, Math.max(0, pageWidth - width)),
      y: clampNumber(requestedY, pageTop, Math.max(pageTop, pageTop + pageHeight - height)),
    };
  };
  const createChartBlock = (chartSpec, point = null, chartView = null) => {
    if (!chartSpec?.id) return;
    const w = Number(chartSpec?.layout?.width) || 640;
    const h = Number(chartSpec?.layout?.height) || 420;
    const id = uid();
    const view = normalizeChartView(chartView);
    const layout = defaultChartSpecBlockLayout(chartSpec, { w, h });
    flushTextForNonTextMutation();
    manuscriptHistory.runImmediateTransaction("block-insert", () => {
      setBlocks((b) => {
        const current = Array.isArray(b) ? b : [];
        const insertAt = insertionPointForBox(point, w, h, { x: 70, y: 70 + current.length * 28 });
        return [...current, {
          id,
          kind: "chart",
          chartSpecId: chartSpec.id,
          chartSpecSnapshot: clone(chartSpec),
          datasetCommitId: chartSpec.datasetCommitId || null,
          chartView: view,
          chartLayout: layout,
          x: insertAt.x,
          y: insertAt.y,
          w,
          h,
        }];
      });
    });
    setSelected(id);
    closeContextMenu();
  };
  const openInsertChartModal = (point = null, chartSpecId = "") => {
    const initialSpec = safeChartSpecs.find((spec) => spec.id === chartSpecId) || safeChartSpecs[0] || null;
    const experimentOptions = initialSpec ? experimentOptionsForChartSpec(initialSpec, genericImports) : [];
    setChartDraft({
      point,
      chartSpecId: initialSpec?.id || "",
      selectedExperimentIds: [],
      excludedExperimentIds: experimentOptions.map((option) => option.id),
    });
    closeContextMenu();
  };
  const closeInsertChartModal = () => {
    setChartDraft(null);
  };
  const insertChartFromDraft = () => {
    if (!chartDraft) return;
    const chartSpec = safeChartSpecs.find((spec) => spec.id === chartDraft.chartSpecId);
    if (!chartSpec) return;
    const experimentOptions = experimentOptionsForChartSpec(chartSpec, genericImports);
    const compatibleIds = new Set(experimentOptions.map((option) => option.id));
    const selectedExperimentIds = Array.isArray(chartDraft.selectedExperimentIds)
      ? chartDraft.selectedExperimentIds.map((id) => String(id || "").trim()).filter((id) => id && (!compatibleIds.size || compatibleIds.has(id)))
      : [];
    if (experimentOptions.length && !selectedExperimentIds.length) return;
    createChartBlock(chartSpec, chartDraft.point, {
      selectedExperimentIds,
      excludedExperimentIds: selectedExperimentIds.length ? [] : chartDraft.excludedExperimentIds,
      filters: chartDraft.filters,
      groupBy: chartDraft.groupBy,
    });
    setChartDraft(null);
  };
  const insertText = (point = null) => {
    const id = uid();
    const initialText = normalizeTextRuns(null, {
      html: "Click to write analysis.",
      fontSize: 15,
      fontFamily: defaultFontFamily,
    });
    flushTextForNonTextMutation();
    manuscriptHistory.runImmediateTransaction("block-insert", () => {
      setBlocks((b) => {
        const current = Array.isArray(b) ? b : [];
        const insertAt = insertionPointForBox(point, 430, 150, { x: 120, y: 120 + current.length * 28 });
        return [...current, {
          id,
          kind: "text",
          x: insertAt.x,
          y: insertAt.y,
          w: 430,
          h: 150,
          html: "Click to write analysis.",
          textRuns: initialText,
          fontSize: 15,
          fontFamily: defaultFontFamily,
          fillColor: DEFAULT_TEXT_FILL,
          noFill: false,
          borderColor: DEFAULT_TEXT_BORDER,
          borderWidth: 1,
          noBorder: false,
        }];
      });
    });
    setSelected(id);
    closeContextMenu();
  };
  const insertImage = (file, point = null) => {
    if (!file) return;
    const id = uid();
    const insertAt = insertionPointForBox(point, 360, 240, { x: 150, y: 150 });
    const reader = new FileReader();
    reader.onload = () => {
      flushTextForNonTextMutation();
      manuscriptHistory.runImmediateTransaction("block-insert", () => {
        setBlocks((b) => [...(Array.isArray(b) ? b : []), { id, kind: "image", x: insertAt.x, y: insertAt.y, w: 360, h: 240, dataUrl: reader.result, name: file.name }]);
      });
      setSelected(id);
    };
    reader.readAsDataURL(file);
    closeContextMenu();
  };
  const openImagePicker = (point = null) => {
    imageInsertPointRef.current = point;
    if (imageInputRef.current) imageInputRef.current.value = "";
    imageInputRef.current?.click();
    closeContextMenu();
  };
  const onImageChosen = (e) => {
    const file = e.target.files?.[0];
    insertImage(file, imageInsertPointRef.current);
    imageInsertPointRef.current = null;
  };
  const handleCanvasContextMenu = (e) => {
    e.preventDefault();
    if (e.target.closest(".canvas-block")) {
      closeContextMenu();
      return;
    }
    closeChartContextMenu();
    closeBlockContextMenu();
    closePageContextMenu();
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasX = Math.max(0, Math.round(e.clientX - rect.left));
    const canvasY = Math.max(0, Math.round(e.clientY - rect.top));
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, canvasX, canvasY });
  };
  const handleCanvasMouseDown = (e) => {
    if (e.target.closest(".canvas-block, .canvas-context-menu, .canvas-add-page-button")) return;
    if (richTextApiRef.current?.ownsToolbarSelection?.()) {
      e.preventDefault();
      e.stopPropagation();
      richTextApiRef.current.releaseToolbarSelection({ transition: TOOLBAR_TRANSITION.RESTORE });
      closeFloatingMenus();
      return;
    }
    commitTextEditSession();
    setSelected(null);
    setEditingTextBoxId(null);
    closeFloatingMenus();
  };
  const handleChartContextMenu = (block, e) => {
    e.preventDefault();
    e.stopPropagation();
    commitTextEditSession();
    closeContextMenu();
    closeBlockContextMenu();
    closePageContextMenu();
    setSelected(block.id);
    setEditingTextBoxId(null);
    setChartContextMenu({ visible: true, x: e.clientX, y: e.clientY, blockId: block.id });
  };
  const handleBlockContextMenu = (block, e) => {
    e.preventDefault();
    e.stopPropagation();
    commitTextEditSession();
    closeContextMenu();
    closeChartContextMenu();
    closePageContextMenu();
    setSelected(block.id);
    setEditingTextBoxId(null);
    setBlockContextMenu({ visible: true, x: e.clientX, y: e.clientY, blockId: block.id });
  };
  const deleteBlock = (id) => {
    flushTextForNonTextMutation();
    manuscriptHistory.runImmediateTransaction("block-delete", () => {
      setBlocks((b) => (Array.isArray(b) ? b : []).filter((x) => x.id !== id));
    });
    if (selectedBlockId === id) setSelected(null);
    if (editingTextBoxId === id) setEditingTextBoxId(null);
    closeContextMenu();
    closeChartContextMenu();
    closeBlockContextMenu();
    closePageContextMenu();
  };
  const focusBlock = (block) => {
    if (!block) return;
    commitTextEditSession();
    setSelected(block.id);
    setEditingTextBoxId(null);
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    wrap.scrollTo({
      left: Math.max(0, (block.x || 0) + (block.w || 0) / 2 - wrap.clientWidth / 2),
      top: Math.max(0, (block.y || 0) + (block.h || 0) / 2 - wrap.clientHeight / 2),
      behavior: "smooth",
    });
  };
  const exportPageRange = async ({ startPage, endPage }) => {
    setExportBusy(true);
    setExportError("");
    try {
      await exportManuscriptPagesToPptx({
        pages: safePages,
        blocks: safeBlocks,
        experiments,
        genericImports,
        chartSpecs: safeChartSpecs,
        startPage,
        endPage,
        filename: `labrat-manuscript-pages-${startPage}-${endPage}.pptx`,
      });
      setExportModalOpen(false);
    } catch (err) {
      setExportError(err.message || String(err));
    } finally {
      setExportBusy(false);
    }
  };
  const handleManuscriptMouseDownCapture = (e) => {
    const toolbarController = toolbarControlControllerRef.current;
    if (richTextApiRef.current?.ownsToolbarSelection?.() && !e.target.closest(".manuscript-toolbar")) {
      const blurBehavior = richTextApiRef.current?.resolveToolbarBlurBehavior?.(e.target) || TOOLBAR_TRANSITION.RESTORE;
      toolbarController?.commitPending?.(blurBehavior);
      if (blurBehavior !== TOOLBAR_TRANSITION.BLOCK_SWITCH) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (!selectedChartComponent) return;
    if (e.target.closest(".chart-layer.is-selected")) return;
    returnToWholeChartMode();
  };
  useEffect(() => {
    if (!contextMenu?.visible) return;
    const onMouseDown = (e) => {
      if (!e.target.closest(".canvas-context-menu")) closeContextMenu();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeContextMenu();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu?.visible]);
  useEffect(() => {
    if (!chartContextMenu?.visible) return;
    const onMouseDown = (e) => {
      if (!e.target.closest(".canvas-context-menu")) closeChartContextMenu();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeChartContextMenu();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [chartContextMenu?.visible]);
  useEffect(() => {
    if (!blockContextMenu?.visible) return;
    const onMouseDown = (e) => {
      if (!e.target.closest(".canvas-context-menu")) closeBlockContextMenu();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeBlockContextMenu();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [blockContextMenu?.visible]);
  useEffect(() => {
    if (!pageContextMenu?.visible) return;
    const onMouseDown = (e) => {
      if (!e.target.closest(".canvas-context-menu")) closePageContextMenu();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") closePageContextMenu();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pageContextMenu?.visible]);
  useEffect(() => {
    if (!selectedChartComponent) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelected(selectedBlockId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedChartComponent, selectedBlockId]);
  useEffect(() => {
    const onKeyDown = (event) => {
      const usesShortcutModifier = event.ctrlKey || event.metaKey;
      if (!usesShortcutModifier) return;
      const target = event.target;
      const editingTarget = typeof target?.closest === "function" ? target.closest("input, textarea, select, [contenteditable='true']") : null;
      if (editingTarget) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoManuscript();
        else undoManuscript();
      } else if (key === "y") {
        event.preventDefault();
        redoManuscript();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoManuscript, redoManuscript]);
  useEffect(() => {
    const session = textEditSessionRef.current;
    if (session && session.blockId !== editingTextBoxId) commitTextEditSession();
  }, [selectedBlockId, editingTextBoxId]);
  useEffect(() => () => {
    clearTextEditTimer();
  }, []);
  useEffect(() => {
    if (!Array.isArray(pages) || pages.length !== safePages.length || Number(canvasHeight) !== effectiveCanvasHeight) {
      setPages?.(safePages);
      setCanvasHeight?.(effectiveCanvasHeight);
    }
  }, [pages, safePages, canvasHeight, effectiveCanvasHeight, setPages, setCanvasHeight]);
  useEffect(() => {
    if (!pageOrientationPreference && inferredPageOrientation) {
      setPageOrientationPreference?.(inferredPageOrientation);
    }
  }, [pageOrientationPreference, inferredPageOrientation, setPageOrientationPreference]);
  useEffect(() => {
    onSelectedChartContextChange?.(selectedBlock?.kind === "chart" ? buildChartContext(selectedBlock, safeChartSpecs, genericImports) : null);
  }, [selectedBlockId, safeBlocks, safeChartSpecs, genericImports, onSelectedChartContextChange]);
  return (
    <div className={`manuscript ${leftSidebarOpen ? "sidebar-open" : "sidebar-closed"} ${inspectorOpen ? "inspector-open" : "inspector-closed"}`} onMouseDownCapture={handleManuscriptMouseDownCapture}>
      {leftSidebarOpen && (
        <aside className="ms-side">
          <div className="ms-side-head">
            <h3>Workspace Overview</h3>
            <button type="button" className="sidebar-toggle" title="Hide workspace overview" aria-label="Hide workspace overview" onClick={() => setLeftSidebarOpen(false)}>‹</button>
          </div>
          <p>{safePages.length} page{safePages.length === 1 ? "" : "s"} with {safeBlocks.length} blocks. {safeChartSpecs.length} approved chart{safeChartSpecs.length === 1 ? "" : "s"}.</p>
          <CanvasOverview
            blocks={safeBlocks}
            genericImports={genericImports}
            chartSpecs={safeChartSpecs}
            selectedBlockId={selectedBlockId}
            pages={safePages}
            canvasWidth={effectiveCanvasWidth}
            canvasHeight={effectiveCanvasHeight}
            onSelectBlock={focusBlock}
            onPageContextMenu={(pageIndex, event) => {
              event.preventDefault();
              closeFloatingMenus();
              setPageContextMenu({ visible: true, x: event.clientX, y: event.clientY, pageIndex });
            }}
          />
          <div className="template-summary approved-chart-summary">
            <h3>Approved Charts</h3>
            {safeChartSpecs.length ? (
              <div className="approved-chart-list">
                {safeChartSpecs.map((chartSpec) => (
                  <button type="button" key={chartSpec.id} onClick={() => openInsertChartModal(null, chartSpec.id)}>
                    <span>{chartSpec.title || "Untitled chart"}</span>
                    <small>{chartSpec.chartType || chartSpecToProposal(chartSpec).chartType || "chart"}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p>No approved chart specs yet.</p>
            )}
          </div>
          <p className="sidebar-hint">Create chart specs from accepted backend proposals, then insert them here.</p>
          <button type="button" className="wide-action" disabled={!safePages.length} onClick={() => {
            setExportError("");
            setExportModalOpen(true);
          }}>Export pages to PowerPoint</button>
          <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onImageChosen} />
          <h3>References</h3>
          <div className="ref-mini">{safeReferences.map((r) => <span key={r.id}>{r.name}</span>)}</div>
        </aside>
      )}
      <main className="canvas-wrap" ref={canvasWrapRef}>
        <ManuscriptToolbar
          textState={textToolbarState}
          activeTextBlock={activeTextBlock}
          canUndo={canUndo}
          canRedo={canRedo}
          onSave={() => {
            commitTextEditSession();
            onSaveProject?.();
          }}
          onUndo={undoManuscript}
          onRedo={redoManuscript}
          onPrepareToolbarSelection={(options) => richTextApiRef.current?.prepareToolbarSelection(options)}
          onReleaseToolbarSelection={(options) => richTextApiRef.current?.releaseToolbarSelection?.(options)}
          onResolveToolbarBlurBehavior={(relatedTarget) => richTextApiRef.current?.resolveToolbarBlurBehavior?.(relatedTarget)}
          onResolveTextState={() => richTextApiRef.current?.getToolbarState?.()}
          onFormat={(patchValue, options) => richTextApiRef.current?.formatInline(patchValue, options)}
          onAlign={(align) => richTextApiRef.current?.alignParagraphs(align)}
          onRegisterToolbarController={(controller) => {
            toolbarControlControllerRef.current = controller;
          }}
        />
        {!leftSidebarOpen && (
          <button type="button" className="sidebar-restore" title="Show workspace overview" aria-label="Show workspace overview" onClick={() => setLeftSidebarOpen(true)}>›</button>
        )}
        <div className={`canvas ${effectiveCanvasHeight <= 0 && !safePages.length ? "is-empty-canvas" : ""}`} style={{ width: effectiveCanvasWidth, height: visibleCanvasHeight }} onMouseDown={handleCanvasMouseDown} onContextMenu={handleCanvasContextMenu}>
          {safePages.map((page, index) => (
            <section key={page.id} className={`canvas-page ${page.orientation || "landscape"}`} style={{ top: page.y, width: page.width, height: page.height }} aria-label={`Page ${index + 1}`}>
              <span className="canvas-page-label">Page {index + 1}</span>
            </section>
          ))}
          {!safeBlocks.length && !safePages.length && <div className="empty-hint">Add a page, then insert an approved chart spec or text box. Chart specs come from backend proposals you accept.</div>}
          {safeBlocks.map((b) => <CanvasBlock key={b.id} genericImports={genericImports} chartSpecs={safeChartSpecs} block={b} canvasWidth={effectiveCanvasWidth} canvasHeight={Math.max(effectiveCanvasHeight, visibleCanvasHeight)} selectedKey={selected} setSelected={setSelected} patch={patchBlock} patchTextRuns={patchTextRuns} remove={deleteBlock} editingTextBoxId={editingTextBoxId} setEditingTextBoxId={setEditingTextBoxId} richTextApiRef={richTextApiRef} onTextToolbarChange={setTextToolbarState} onBeginTextEdit={beginTextEditSession} onCommitTextEdit={commitTextEditSession} onBeginTransaction={beginHistoryTransaction} onCommitTransaction={commitHistoryTransaction} onUndo={undoManuscript} onRedo={redoManuscript} onChartContextMenu={handleChartContextMenu} onBlockContextMenu={handleBlockContextMenu} />)}
          {chartAssistBlock && (
            <ChartAssistBubble
              block={chartAssistBlock}
              canvasWidth={effectiveCanvasWidth}
              canvasHeight={effectiveCanvasHeight}
              logoSrc={logoSrc}
              onClick={() => onRequestChartAnalysis?.(chartAssistBlock.id)}
              onClose={() => setDismissedChartAssistId(chartAssistBlock.id)}
            />
          )}
        </div>
        <div className="canvas-add-footer">
          <button
            type="button"
            className="canvas-add-page-button"
            title="Add page"
            aria-label="Add page"
            onClick={() => {
              closeFloatingMenus();
              requestPageAction({ type: "append" });
            }}
          >
            +
          </button>
        </div>
      </main>
      {contextMenu?.visible && (
        <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button disabled={!safeChartSpecs.length} onClick={() => openInsertChartModal({ x: contextMenu.canvasX, y: contextMenu.canvasY })}>Insert approved chart</button>
          <button onClick={() => insertText({ x: contextMenu.canvasX, y: contextMenu.canvasY })}>Insert text box</button>
          <button onClick={() => openImagePicker({ x: contextMenu.canvasX, y: contextMenu.canvasY })}>Insert image...</button>
        </div>
      )}
      {chartContextMenu?.visible && (
        <ChartContextMenu
          x={chartContextMenu.x}
          y={chartContextMenu.y}
          block={safeBlocks.find((b) => b.id === chartContextMenu.blockId)}
          onDelete={deleteBlock}
        />
      )}
      {blockContextMenu?.visible && (
        <BlockContextMenu
          x={blockContextMenu.x}
          y={blockContextMenu.y}
          block={safeBlocks.find((b) => b.id === blockContextMenu.blockId)}
          onDelete={deleteBlock}
        />
      )}
      {pageContextMenu?.visible && (
        <PageContextMenu
          x={pageContextMenu.x}
          y={pageContextMenu.y}
          pageIndex={pageContextMenu.pageIndex}
          onAddBefore={() => insertPageAtY(safePages[pageContextMenu.pageIndex]?.y || 0)}
          onAddAfter={() => {
            const page = safePages[pageContextMenu.pageIndex];
            insertPageAtY(page ? page.y + page.height : effectiveCanvasHeight);
          }}
          onDelete={() => deletePageAt(pageContextMenu.pageIndex)}
        />
      )}
      {orientationChoiceRequest && (
        <PageOrientationModal
          onCancel={() => setOrientationChoiceRequest(null)}
          onChoose={choosePageOrientation}
        />
      )}
      {chartDraft && (
        <InsertChartModal
          draft={chartDraft}
          dataset={dataset}
          chartSpecs={safeChartSpecs}
          genericImports={genericImports}
          onPatch={(patch) => setChartDraft((current) => current ? { ...current, ...patch } : current)}
          onCancel={closeInsertChartModal}
          onInsert={insertChartFromDraft}
        />
      )}
      {exportModalOpen && (
        <ExportPptxModal
          pageCount={safePages.length}
          busy={exportBusy}
          error={exportError}
          onCancel={() => {
            if (!exportBusy) setExportModalOpen(false);
          }}
          onExport={exportPageRange}
        />
      )}
      {selectedBlock && <Inspector block={selectedBlock} chartSpecs={safeChartSpecs} genericImports={genericImports} patch={patchBlock} />}
    </div>
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPage(index = 0, y = 0, orientation = "landscape") {
  const normalizedOrientation = normalizePageOrientation(orientation) || "landscape";
  const size = pageSizeForOrientation(normalizedOrientation);
  return {
    id: `page-${uid()}-${index + 1}`,
    y: Math.max(0, Number(y) || 0),
    width: size.width,
    height: size.height,
    orientation: normalizedOrientation,
  };
}

function pageSizeForOrientation(orientation) {
  return normalizePageOrientation(orientation) === "portrait"
    ? { width: PORTRAIT_PAGE_WIDTH, height: PORTRAIT_PAGE_HEIGHT }
    : { width: LANDSCAPE_PAGE_WIDTH, height: LANDSCAPE_PAGE_HEIGHT };
}

function normalizePageOrientation(value) {
  return value === "landscape" || value === "portrait" ? value : null;
}

function inferPageOrientation(pages) {
  const firstPage = Array.isArray(pages) ? pages[0] : null;
  if (!firstPage) return null;
  return normalizePageOrientation(firstPage.orientation) || ((Number(firstPage.width) || 0) >= (Number(firstPage.height) || 0) ? "landscape" : "portrait");
}

function normalizeManuscriptPages(pages, blocks = []) {
  const hasBlocks = Array.isArray(blocks) && blocks.length > 0;
  if (!hasBlocks && isBlankLegacyAutoPage(pages)) return [];
  if (Array.isArray(pages) && pages.length) {
    return pages.map((page, index) => ({
      id: page?.id || `page-${index + 1}`,
      y: Math.max(0, Number(page?.y) || legacyPageY(page, index)),
      width: Math.max(1, Number(page?.width) || LEGACY_PAGE_WIDTH),
      height: Math.max(1, Number(page?.height) || LEGACY_PAGE_HEIGHT),
      orientation: page?.orientation || ((Number(page?.width) || LEGACY_PAGE_WIDTH) >= (Number(page?.height) || LEGACY_PAGE_HEIGHT) ? "landscape" : "portrait"),
    })).sort((a, b) => (a.y || 0) - (b.y || 0));
  }
  return [];
}

function legacyPageY(page, index) {
  const height = Number(page?.height) || LEGACY_PAGE_HEIGHT;
  return index * height;
}

function isBlankLegacyAutoPage(pages) {
  if (!Array.isArray(pages) || pages.length !== 1) return false;
  const page = pages[0] || {};
  const y = Number(page.y) || 0;
  const width = Number(page.width) || LEGACY_PAGE_WIDTH;
  const height = Number(page.height) || LEGACY_PAGE_HEIGHT;
  return y === 0 && width === LEGACY_PAGE_WIDTH && height === LEGACY_PAGE_HEIGHT;
}

function manuscriptHeight(pages, canvasHeight = 0, requiredCanvasHeight = 0) {
  const pageBottom = (Array.isArray(pages) ? pages : []).reduce((max, page) => Math.max(max, (Number(page.y) || 0) + (Number(page.height) || 0)), 0);
  if (pageBottom > 0) return pageBottom;
  return Math.max(0, Number(canvasHeight) || 0, Number(requiredCanvasHeight) || 0, pageBottom);
}

function manuscriptWidth(pages, blocks = []) {
  const pageRight = (Array.isArray(pages) ? pages : []).reduce((max, page) => Math.max(max, Number(page.width) || 0), 0);
  const blockRight = (Array.isArray(blocks) ? blocks : []).reduce((max, block) => Math.max(max, (Number(block.x) || 0) + (Number(block.w) || 0)), 0);
  return Math.max(CANVAS_WIDTH, pageRight, blockRight);
}

function shiftPagesFromY(pages, thresholdY, shift, excludeId = null) {
  return (Array.isArray(pages) ? pages : []).map((page) => {
    if (page.id === excludeId || (Number(page.y) || 0) < thresholdY) return page;
    return { ...page, y: Math.max(0, (Number(page.y) || 0) + shift) };
  });
}

function normalizeManuscriptBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block && typeof block === "object")
    .map((block, index) => {
      const kind = ["chart", "text", "image"].includes(block.kind) ? block.kind : null;
      if (!kind) return null;
      const normalized = {
        ...block,
        id: block.id || `block-${index + 1}`,
        kind,
        x: Math.max(0, Number(block.x) || 0),
        y: Math.max(0, Number(block.y) || 0),
        w: Math.max(24, Number(block.w) || (kind === "chart" ? 580 : kind === "image" ? 360 : 430)),
        h: Math.max(18, Number(block.h) || (kind === "chart" ? 380 : kind === "image" ? 240 : 150)),
      };
      if (kind === "text") {
        normalized.html = String(block.html ?? "");
        normalized.fontSize = Number(block.fontSize) || 15;
        normalized.fontFamily = block.fontFamily || defaultFontFamily;
        normalized.textRuns = normalizeTextRuns(block.textRuns, normalized);
        normalized.fillColor = normalizeCssColor(block.fillColor, DEFAULT_TEXT_FILL);
        normalized.noFill = !!block.noFill;
        normalized.borderColor = normalizeCssColor(block.borderColor, DEFAULT_TEXT_BORDER);
        normalized.borderWidth = Math.max(0, Number(block.borderWidth) || 0);
        normalized.noBorder = !!block.noBorder;
      }
      if (kind === "chart") {
        normalized.chartSpecId = String(block.chartSpecId || "");
        normalized.chartSpecSnapshot = block.chartSpecSnapshot && typeof block.chartSpecSnapshot === "object" ? block.chartSpecSnapshot : null;
        normalized.datasetCommitId = block.datasetCommitId || normalized.chartSpecSnapshot?.datasetCommitId || null;
        normalized.chartView = normalizeChartView(block.chartView);
        normalized.chartLayout = block.chartLayout && typeof block.chartLayout === "object" ? block.chartLayout : {};
      }
      return normalized;
    })
    .filter(Boolean);
}

function normalizeChartView(value) {
  const safe = value && typeof value === "object" ? value : {};
  const idList = (items) => (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return {
    selectedExperimentIds: idList(safe.selectedExperimentIds),
    excludedExperimentIds: idList(safe.excludedExperimentIds),
    filters: (Array.isArray(safe.filters) ? safe.filters : []).filter((filter) => filter && typeof filter === "object").map((filter) => ({ ...filter })),
    groupBy: safe.groupBy || null,
  };
}

function normalizeChartSpecs(chartSpecs) {
  return (Array.isArray(chartSpecs) ? chartSpecs : [])
    .filter((chartSpec) => chartSpec && typeof chartSpec === "object" && chartSpec.id)
    .filter((chartSpec) => !chartSpec.isStale && chartSpec.status !== "stale")
    .map((chartSpec) => ({
      ...chartSpec,
      id: String(chartSpec.id),
      title: chartSpec.title || chartSpec.spec?.title || "Untitled chart",
      chartType: chartSpec.chartType || chartSpec.spec?.chartType || "scatter",
      spec: chartSpec.spec && typeof chartSpec.spec === "object" ? chartSpec.spec : chartSpec,
      layout: chartSpec.layout && typeof chartSpec.layout === "object" ? chartSpec.layout : {},
      warnings: Array.isArray(chartSpec.warnings) ? chartSpec.warnings : [],
    }));
}

function resolveChartSpecForBlock(block, chartSpecs) {
  return (Array.isArray(chartSpecs) ? chartSpecs : []).find((chartSpec) => chartSpec.id === block?.chartSpecId)
    || block?.chartSpecSnapshot
    || null;
}

function chartSpecAxisTitle(axis, fallback) {
  const label = axis?.label || axis?.field || fallback;
  const unit = axis?.unit ? ` (${axis.unit})` : "";
  return `${label || fallback || ""}${unit}`;
}

function chartSpecLayoutOpts(chartSpec) {
  const proposal = chartSpecToProposal(chartSpec);
  const yFields = Array.isArray(proposal.yFields) && proposal.yFields.length ? proposal.yFields : [proposal.y].filter(Boolean);
  return {
    title: proposal.title || chartSpec?.title || "Chart",
    xLabel: chartSpecAxisTitle(proposal.x, "Experiment"),
    yLabel: yFields.length > 1 ? "Value" : chartSpecAxisTitle(yFields[0], "Value"),
  };
}

function chartSpecLayoutBlock(block, chartSpec) {
  const proposal = chartSpecToProposal(chartSpec);
  return {
    ...block,
    chartKind: proposal.chartType || chartSpec?.chartType || "scatter",
    opts: chartSpecLayoutOpts(chartSpec),
  };
}

function resolveChartSpecBlockLayout(block, chartSpec) {
  const layout = resolveChartLayout(chartSpecLayoutBlock(block, chartSpec));
  if (!block?.chartLayout?.xAxisTitle) {
    layout.xAxisTitle = { ...layout.xAxisTitle, visible: true };
  }
  return layout;
}

function defaultChartSpecBlockLayout(chartSpec, block) {
  const layoutBlock = chartSpecLayoutBlock({ ...block, chartLayout: null }, chartSpec);
  const layout = defaultChartLayout(layoutBlock.chartKind, layoutBlock.opts, layoutBlock);
  return { ...layout, xAxisTitle: { ...layout.xAxisTitle, visible: true } };
}

function patchChartSpecBlockLayout(block, chartSpec, section, patchValue) {
  const result = patchChartLayout(chartSpecLayoutBlock(block, chartSpec), section, patchValue);
  const hasSavedXAxisTitle = !!block?.chartLayout?.xAxisTitle;
  const explicitlyHidingXAxisTitle = section === "xAxisTitle" && patchValue?.visible === false;
  if (!hasSavedXAxisTitle && !explicitlyHidingXAxisTitle) {
    result.chartLayout = {
      ...result.chartLayout,
      xAxisTitle: { ...result.chartLayout.xAxisTitle, visible: true },
    };
  }
  return result;
}

function chartSpecBlockPlot(block, chartSpec, genericImports, options = {}) {
  if (!chartSpec) return null;
  const chartLayout = resolveChartSpecBlockLayout(block, chartSpec);
  const plotArea = chartLayout.plotArea || {};
  const width = Math.max(1, Math.round(Number(options.width) || Number(plotArea.width) || Number(block.w) || 580));
  const height = Math.max(1, Math.round(Number(options.height) || Number(plotArea.height) || Number(block.h) || 380));
  const plot = makeGenericChartPreview(chartSpec, genericImports, {
    width,
    height,
    chartView: normalizeChartView(block.chartView),
    config: options.config,
  });
  return applyChartLayout(plot, chartLayout);
}

function normalizeCssColor(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function defaultTextRunStyle(block = {}) {
  return {
    fontFamily: block.fontFamily || defaultFontFamily,
    fontSize: Math.max(1, Number(block.fontSize) || 15),
    bold: false,
    italic: false,
    underline: false,
    color: normalizeCssColor(block.color, DEFAULT_TEXT_COLOR),
  };
}

function inlineStyleFromState(style, block = {}) {
  const fallbackStyle = defaultTextRunStyle(block);
  const normalized = normalizeTextRun({ ...fallbackStyle, ...(style || {}), text: "" }, fallbackStyle);
  const { text, ...inlineStyle } = normalized;
  return inlineStyle;
}

function normalizeTextRuns(value, block = {}) {
  const fallbackStyle = defaultTextRunStyle(block);
  const paragraphs = Array.isArray(value?.paragraphs) ? value.paragraphs : null;
  if (!paragraphs) {
    const text = plainTextFromLegacyHtml(block.html || "");
    return {
      paragraphs: (text ? text.split(/\r?\n/) : [""]).map((line) => ({
        align: "left",
        runs: [{ ...fallbackStyle, text: line }],
      })),
    };
  }
  const normalizedParagraphs = paragraphs.map((paragraph) => {
    const runs = (Array.isArray(paragraph?.runs) ? paragraph.runs : [])
      .map((run) => normalizeTextRun(run, fallbackStyle))
      .filter((run) => run.text.length || paragraph?.runs?.length === 1);
    return {
      align: normalizeTextAlign(paragraph?.align),
      runs: normalizeAdjacentRuns(runs.length ? runs : [{ ...fallbackStyle, text: "" }]),
    };
  });
  return { paragraphs: normalizedParagraphs.length ? normalizedParagraphs : [{ align: "left", runs: [{ ...fallbackStyle, text: "" }] }] };
}

function normalizeTextRun(run, fallbackStyle) {
  return {
    text: String(run?.text ?? ""),
    fontFamily: run?.fontFamily || fallbackStyle.fontFamily,
    fontSize: Math.max(1, Number(run?.fontSize) || fallbackStyle.fontSize),
    bold: !!run?.bold,
    italic: !!run?.italic,
    underline: !!run?.underline,
    color: normalizeCssColor(run?.color, fallbackStyle.color),
  };
}

function normalizeTextAlign(value) {
  return ["left", "center", "right"].includes(value) ? value : "left";
}

function plainTextFromLegacyHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function plainTextFromTextRuns(textRuns) {
  return normalizeTextRuns(textRuns).paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
    .join("\n");
}

function textRunsEqual(a, b) {
  return JSON.stringify(normalizeTextRuns(a)) === JSON.stringify(normalizeTextRuns(b));
}

function paragraphLength(paragraph) {
  return (paragraph?.runs || []).reduce((total, run) => total + String(run.text || "").length, 0);
}

function orderTextSelection(selection) {
  if (!selection?.start || !selection?.end) return null;
  const start = selection.start;
  const end = selection.end;
  const flipped = start.p > end.p || (start.p === end.p && start.offset > end.offset);
  return flipped ? { start: end, end: start } : { start, end };
}

function isCollapsedSelection(selection) {
  const ordered = orderTextSelection(selection);
  return !ordered || (ordered.start.p === ordered.end.p && ordered.start.offset === ordered.end.offset);
}

function normalizeAdjacentRuns(runs) {
  const merged = [];
  (Array.isArray(runs) ? runs : []).forEach((run) => {
    const clean = { ...run, text: String(run.text || "") };
    const prev = merged[merged.length - 1];
    if (prev && sameRunStyle(prev, clean)) {
      prev.text += clean.text;
    } else if (clean.text.length || !merged.length) {
      merged.push(clean);
    }
  });
  return merged.length ? merged : [{ ...defaultTextRunStyle(), text: "" }];
}

function sameRunStyle(a, b) {
  return (a.fontFamily || "") === (b.fontFamily || "")
    && Number(a.fontSize) === Number(b.fontSize)
    && !!a.bold === !!b.bold
    && !!a.italic === !!b.italic
    && !!a.underline === !!b.underline
    && normalizeCssColor(a.color, DEFAULT_TEXT_COLOR) === normalizeCssColor(b.color, DEFAULT_TEXT_COLOR);
}

function splitRunsAt(runs, offset) {
  const before = [];
  const after = [];
  let cursor = 0;
  (runs || []).forEach((run) => {
    const text = String(run.text || "");
    const nextCursor = cursor + text.length;
    if (nextCursor <= offset) {
      before.push({ ...run, text });
    } else if (cursor >= offset) {
      after.push({ ...run, text });
    } else {
      const local = Math.max(0, offset - cursor);
      before.push({ ...run, text: text.slice(0, local) });
      after.push({ ...run, text: text.slice(local) });
    }
    cursor = nextCursor;
  });
  return {
    before: before.filter((run) => run.text.length),
    after: after.filter((run) => run.text.length),
  };
}

function runStyleAt(textRuns, selection, block) {
  const model = normalizeTextRuns(textRuns, block);
  const ordered = orderTextSelection(selection);
  const pos = ordered?.start || { p: 0, offset: 0 };
  const paragraph = model.paragraphs[Math.max(0, Math.min(model.paragraphs.length - 1, pos.p))] || model.paragraphs[0];
  let cursor = 0;
  for (const run of paragraph.runs) {
    const len = String(run.text || "").length;
    if (pos.offset <= cursor + len) return { ...defaultTextRunStyle(block), ...run, align: paragraph.align };
    cursor += len;
  }
  return { ...defaultTextRunStyle(block), ...(paragraph.runs[paragraph.runs.length - 1] || {}), align: paragraph.align };
}

function overlappingRunStyles(textRuns, selection, block) {
  const model = normalizeTextRuns(textRuns, block);
  const ordered = orderTextSelection(selection);
  if (!ordered || isCollapsedSelection(ordered)) return [];
  const styles = [];
  model.paragraphs.forEach((paragraph, pIndex) => {
    if (pIndex < ordered.start.p || pIndex > ordered.end.p) return;
    const start = pIndex === ordered.start.p ? ordered.start.offset : 0;
    const end = pIndex === ordered.end.p ? ordered.end.offset : paragraphLength(paragraph);
    if (end <= start) return;
    let cursor = 0;
    paragraph.runs.forEach((run) => {
      const text = String(run.text || "");
      const nextCursor = cursor + text.length;
      if (nextCursor > start && cursor < end) styles.push({ ...run, align: paragraph.align });
      cursor = nextCursor;
    });
  });
  return styles;
}

function summarizeInlineFlag(styles, key, fallback) {
  if (!styles.length) return fallback;
  const first = !!styles[0]?.[key];
  return styles.every((style) => !!style?.[key] === first) ? first : "mixed";
}

function summarizeInlineStyle(textRuns, selection, block) {
  const ordered = orderTextSelection(selection);
  const caretStyle = runStyleAt(textRuns, ordered, block);
  if (!ordered || isCollapsedSelection(ordered)) return caretStyle;
  const styles = overlappingRunStyles(textRuns, ordered, block);
  if (!styles.length) return caretStyle;
  const sameValue = (key) => {
    const first = styles[0]?.[key];
    return styles.every((style) => style?.[key] === first) ? first : caretStyle[key];
  };
  return {
    ...caretStyle,
    fontFamily: sameValue("fontFamily"),
    fontSize: sameValue("fontSize"),
    color: sameValue("color"),
    bold: summarizeInlineFlag(styles, "bold", caretStyle.bold),
    italic: summarizeInlineFlag(styles, "italic", caretStyle.italic),
    underline: summarizeInlineFlag(styles, "underline", caretStyle.underline),
  };
}

function applyInlineFormat(textRuns, selection, patchValue, block) {
  const model = normalizeTextRuns(textRuns, block);
  const ordered = orderTextSelection(selection);
  if (!ordered || isCollapsedSelection(ordered)) return model;
  const nextParagraphs = model.paragraphs.map((paragraph, pIndex) => {
    if (pIndex < ordered.start.p || pIndex > ordered.end.p) return paragraph;
    const start = pIndex === ordered.start.p ? ordered.start.offset : 0;
    const end = pIndex === ordered.end.p ? ordered.end.offset : paragraphLength(paragraph);
    return { ...paragraph, runs: styleRunsInRange(paragraph.runs, start, end, patchValue, block) };
  });
  return { paragraphs: nextParagraphs };
}

function styleRunsInRange(runs, start, end, patchValue, block) {
  if (end <= start) return runs;
  const styled = [];
  let cursor = 0;
  (runs || []).forEach((run) => {
    const text = String(run.text || "");
    const nextCursor = cursor + text.length;
    if (nextCursor <= start || cursor >= end) {
      styled.push(run);
    } else {
      const left = Math.max(0, start - cursor);
      const right = Math.min(text.length, end - cursor);
      if (left > 0) styled.push({ ...run, text: text.slice(0, left) });
      styled.push(normalizeTextRun({ ...run, ...patchValue, text: text.slice(left, right) }, defaultTextRunStyle(block)));
      if (right < text.length) styled.push({ ...run, text: text.slice(right) });
    }
    cursor = nextCursor;
  });
  return normalizeAdjacentRuns(styled);
}

function applyParagraphAlign(textRuns, selection, align, block) {
  const model = normalizeTextRuns(textRuns, block);
  const ordered = orderTextSelection(selection) || { start: { p: 0, offset: 0 }, end: { p: 0, offset: 0 } };
  const startP = Math.max(0, Math.min(model.paragraphs.length - 1, ordered.start.p));
  const endP = Math.max(startP, Math.min(model.paragraphs.length - 1, ordered.end.p));
  return {
    paragraphs: model.paragraphs.map((paragraph, index) => (
      index >= startP && index <= endP ? { ...paragraph, align: normalizeTextAlign(align) } : paragraph
    )),
  };
}

function deleteTextSelection(textRuns, selection, block) {
  const model = normalizeTextRuns(textRuns, block);
  const ordered = orderTextSelection(selection);
  if (!ordered || isCollapsedSelection(ordered)) return { textRuns: model, selection: ordered };
  if (ordered.start.p === ordered.end.p) {
    const paragraph = model.paragraphs[ordered.start.p];
    const first = splitRunsAt(paragraph.runs, ordered.start.offset).before;
    const second = splitRunsAt(paragraph.runs, ordered.end.offset).after;
    const paragraphs = [...model.paragraphs];
    paragraphs[ordered.start.p] = { ...paragraph, runs: normalizeAdjacentRuns([...first, ...second]) };
    return { textRuns: { paragraphs }, selection: { start: ordered.start, end: ordered.start } };
  }
  const startParagraph = model.paragraphs[ordered.start.p];
  const endParagraph = model.paragraphs[ordered.end.p];
  const startRuns = splitRunsAt(startParagraph.runs, ordered.start.offset).before;
  const endRuns = splitRunsAt(endParagraph.runs, ordered.end.offset).after;
  const mergedParagraph = { ...startParagraph, runs: normalizeAdjacentRuns([...startRuns, ...endRuns]) };
  const paragraphs = [
    ...model.paragraphs.slice(0, ordered.start.p),
    mergedParagraph,
    ...model.paragraphs.slice(ordered.end.p + 1),
  ];
  return { textRuns: { paragraphs }, selection: { start: ordered.start, end: ordered.start } };
}

function insertTextAtSelection(textRuns, selection, text, style, block) {
  const deleted = deleteTextSelection(textRuns, selection, block);
  const model = normalizeTextRuns(deleted.textRuns, block);
  const pos = deleted.selection?.start || { p: 0, offset: 0 };
  const paragraph = model.paragraphs[pos.p] || model.paragraphs[0];
  const parts = String(text || "").replace(/\r/g, "").split("\n");
  const split = splitRunsAt(paragraph.runs, pos.offset);
  const runStyle = normalizeTextRun({ ...style, text: "" }, defaultTextRunStyle(block));
  if (parts.length === 1) {
    const insertRun = { ...runStyle, text: parts[0] };
    const paragraphs = [...model.paragraphs];
    paragraphs[pos.p] = { ...paragraph, runs: normalizeAdjacentRuns([...split.before, insertRun, ...split.after]) };
    const nextPos = { p: pos.p, offset: pos.offset + parts[0].length };
    return { textRuns: { paragraphs }, selection: { start: nextPos, end: nextPos } };
  }
  const newParagraphs = [];
  newParagraphs.push({ ...paragraph, runs: normalizeAdjacentRuns([...split.before, { ...runStyle, text: parts[0] }]) });
  parts.slice(1, -1).forEach((part) => {
    newParagraphs.push({ align: paragraph.align, runs: normalizeAdjacentRuns([{ ...runStyle, text: part }]) });
  });
  newParagraphs.push({ align: paragraph.align, runs: normalizeAdjacentRuns([{ ...runStyle, text: parts[parts.length - 1] }, ...split.after]) });
  const paragraphs = [
    ...model.paragraphs.slice(0, pos.p),
    ...newParagraphs,
    ...model.paragraphs.slice(pos.p + 1),
  ];
  const nextPos = { p: pos.p + parts.length - 1, offset: parts[parts.length - 1].length };
  return { textRuns: { paragraphs }, selection: { start: nextPos, end: nextPos } };
}

function deleteBackward(textRuns, selection, block) {
  const ordered = orderTextSelection(selection);
  if (!ordered || !isCollapsedSelection(ordered)) return deleteTextSelection(textRuns, selection, block);
  if (ordered.start.offset > 0) {
    return deleteTextSelection(textRuns, { start: { ...ordered.start, offset: ordered.start.offset - 1 }, end: ordered.start }, block);
  }
  if (ordered.start.p <= 0) return { textRuns: normalizeTextRuns(textRuns, block), selection: ordered };
  const model = normalizeTextRuns(textRuns, block);
  const prev = model.paragraphs[ordered.start.p - 1];
  const current = model.paragraphs[ordered.start.p];
  const prevLength = paragraphLength(prev);
  const paragraphs = [
    ...model.paragraphs.slice(0, ordered.start.p - 1),
    { ...prev, runs: normalizeAdjacentRuns([...prev.runs, ...current.runs]) },
    ...model.paragraphs.slice(ordered.start.p + 1),
  ];
  const nextPos = { p: ordered.start.p - 1, offset: prevLength };
  return { textRuns: { paragraphs }, selection: { start: nextPos, end: nextPos } };
}

function deleteForward(textRuns, selection, block) {
  const ordered = orderTextSelection(selection);
  if (!ordered || !isCollapsedSelection(ordered)) return deleteTextSelection(textRuns, selection, block);
  const model = normalizeTextRuns(textRuns, block);
  const paragraph = model.paragraphs[ordered.start.p];
  if (ordered.start.offset < paragraphLength(paragraph)) {
    return deleteTextSelection(textRuns, { start: ordered.start, end: { ...ordered.start, offset: ordered.start.offset + 1 } }, block);
  }
  if (ordered.start.p >= model.paragraphs.length - 1) return { textRuns: model, selection: ordered };
  const next = model.paragraphs[ordered.start.p + 1];
  const paragraphs = [...model.paragraphs];
  paragraphs[ordered.start.p] = { ...paragraph, runs: normalizeAdjacentRuns([...paragraph.runs, ...next.runs]) };
  paragraphs.splice(ordered.start.p + 1, 1);
  return { textRuns: { paragraphs }, selection: ordered };
}

function textBlockStyle(block) {
  const noFill = !!block.noFill;
  const noBorder = !!block.noBorder || Number(block.borderWidth) <= 0;
  const borderWidth = Math.max(0, Number(block.borderWidth) || 0);
  return {
    background: noFill ? "transparent" : normalizeCssColor(block.fillColor, DEFAULT_TEXT_FILL),
    borderColor: noBorder ? "transparent" : normalizeCssColor(block.borderColor, DEFAULT_TEXT_BORDER),
    borderWidth: noBorder ? 0 : borderWidth,
    borderStyle: noBorder ? "solid" : "solid",
  };
}

function canvasHeightForBlocks(blocks) {
  const bottom = (Array.isArray(blocks) ? blocks : []).reduce((max, block) => {
    const y = Number(block?.y) || 0;
    const h = Number(block?.h) || 0;
    return Math.max(max, y + h);
  }, 0);
  return bottom ? Math.ceil(bottom) : 0;
}

function clampNumber(value, min, max) {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? Math.max(safeMin, max) : safeMin;
  return Math.min(Math.max(safeMin, Number(value) || safeMin), safeMax);
}

function normalizeToolbarFontSizeValue(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  return clampNumber(numeric, MIN_FONT_SIZE, MAX_FONT_SIZE);
}

function formatToolbarFontSizeValue(value) {
  const normalized = normalizeToolbarFontSizeValue(value);
  if (normalized == null) return "";
  return Number.isInteger(normalized) ? String(normalized) : String(normalized);
}

function buildChartContext(block, chartSpecs, genericImports) {
  const chartSpec = resolveChartSpecForBlock(block, chartSpecs);
  if (!chartSpec) {
    return {
      blockId: block.id,
      chartSpecId: block.chartSpecId || null,
      title: "Missing chart spec",
      block: { x: block.x || 0, y: block.y || 0, w: block.w || 580, h: block.h || 380 },
      plottedData: { traces: [] },
      warnings: ["The manuscript chart references a chart spec that is not available."],
    };
  }
  const proposal = chartSpecToProposal(chartSpec);
  const plot = chartSpecBlockPlot(block, chartSpec, genericImports, { width: block.w || 580, height: block.h || 380 });
  const chartLayout = resolveChartSpecBlockLayout(block, chartSpec);
  return {
    blockId: block.id,
    chartSpecId: chartSpec.id || block.chartSpecId || null,
    chartType: proposal.chartType || "chart",
    title: chartLayout.title?.text || proposal.title || "Chart",
    block: { x: block.x || 0, y: block.y || 0, w: block.w || 580, h: block.h || 380 },
    chartView: normalizeChartView(block.chartView),
    axisTitles: {
      x: chartLayout.xAxisTitle?.text || proposal.x?.label || proposal.x?.field || "",
      y: chartLayout.yAxisTitle?.text || proposal.y?.label || proposal.y?.field || "",
    },
    sourceRefs: proposal.sourceRefs || [],
    sourceImportIds: proposal.sourceImportIds || [],
    plottedData: summarizePlotForAssistant(plot),
  };
}

function compactExperimentForChart(exp) {
  return {
    label: exp.label,
    date: exp.date,
    catalyst_type: exp.catalyst_type,
    temperature_C: exp.temperature_C,
    pressure_bar: exp.pressure_bar,
    reaction_time_hr: exp.reaction_time_hr,
    rpm: exp.rpm,
    impeller: exp.impeller,
    conversion_pct: exp.conversion_pct,
    selectivity_solid_pct: exp.selectivity_solid_pct,
    selectivity_liquid_pct: exp.selectivity_liquid_pct,
    selectivity_gas_pct: exp.selectivity_gas_pct,
    carbon_balance_pct: exp.carbon_balance_pct,
    viscosity_cP: exp.viscosity_cP,
    comments: exp.comments,
  };
}

function summarizePlotForAssistant(plot) {
  return {
    traces: (plot.traces || []).slice(0, 8).map((trace) => ({
      name: trace.name || "",
      type: trace.type || "",
      mode: trace.mode || "",
      x: summarizeArray(trace.x),
      y: summarizeArray(trace.y),
    })),
  };
}

function summarizeArray(values) {
  const arr = Array.isArray(values) ? values : [];
  const numeric = arr.filter((value) => typeof value === "number" && Number.isFinite(value));
  return {
    count: arr.length,
    sample: arr.slice(0, 12),
    min: numeric.length ? Math.min(...numeric) : null,
    max: numeric.length ? Math.max(...numeric) : null,
  };
}

function normalizeChartTemplates(templates) {
  return (Array.isArray(templates) ? templates : [])
    .filter((template) => template && template.kind === "chart")
    .map((template) => ({
      id: template.id || uid(),
      kind: "chart",
      name: String(template.name || "Untitled chart template"),
      chartKind: template.chartKind || "selectivity",
      w: Number(template.w) || 580,
      h: Number(template.h) || 380,
      chartLayout: template.chartLayout || null,
      opts: template.opts || {},
      createdAt: template.createdAt || Date.now(),
    }));
}

function ManuscriptToolbar({ textState, activeTextBlock, canUndo, canRedo, onSave, onUndo, onRedo, onPrepareToolbarSelection, onReleaseToolbarSelection, onResolveToolbarBlurBehavior, onResolveTextState, onFormat, onAlign, onRegisterToolbarController }) {
  const active = !!activeTextBlock && !!textState?.active;
  const state = textState || runStyleAt(activeTextBlock?.textRuns, null, activeTextBlock || {});
  const fontSize = normalizeToolbarFontSizeValue(state.fontSize) ?? normalizeToolbarFontSizeValue(activeTextBlock?.fontSize) ?? 15;
  const color = normalizeCssColor(state.color, DEFAULT_TEXT_COLOR);
  const align = normalizeTextAlign(state.align);
  const [fontSizeDraft, setFontSizeDraft] = useState(() => formatToolbarFontSizeValue(fontSize));
  const fontSizeInputRef = useRef(null);
  const fontFamilySelectRef = useRef(null);
  const textColorInputRef = useRef(null);
  const fontSizeDraftRef = useRef(fontSizeDraft);
  const fontSizeValueRef = useRef(fontSize);
  const toolbarControlStateRef = useRef({
    activeControl: null,
    skipBlur: {
      fontSize: false,
      fontFamily: false,
      textColor: false,
    },
  });
  fontSizeDraftRef.current = fontSizeDraft;
  fontSizeValueRef.current = fontSize;
  const styleIsActive = (value) => value === true;
  const styleIsMixed = (value) => value === "mixed";
  const nextStyleToggleValue = (value) => (value === true ? false : true);
  const setActiveToolbarControl = (controlId) => {
    toolbarControlStateRef.current.activeControl = controlId;
  };
  const clearActiveToolbarControl = (controlId = null) => {
    if (!controlId || toolbarControlStateRef.current.activeControl === controlId) {
      toolbarControlStateRef.current.activeControl = null;
    }
  };
  const setSkipBlur = (controlId, next) => {
    toolbarControlStateRef.current.skipBlur[controlId] = next;
  };
  const consumeSkipBlur = (controlId) => {
    const current = !!toolbarControlStateRef.current.skipBlur[controlId];
    toolbarControlStateRef.current.skipBlur[controlId] = false;
    return current;
  };
  const setFontSizeDraftValue = (value) => {
    fontSizeDraftRef.current = value;
    setFontSizeDraft(value);
  };
  const prepareToolbarSelection = (event, options = {}) => {
    if (!active) return;
    if (options.preventDefault) event.preventDefault();
    event.stopPropagation();
    onPrepareToolbarSelection?.(options);
  };
  const prepareToolbarFocusControl = (event, controlId) => {
    prepareToolbarSelection(event, { controlId, focusBehavior: "preview" });
  };
  const prepareToolbarButton = (event, controlId) => {
    prepareToolbarSelection(event, { controlId, focusBehavior: "preserve-active", preventDefault: true });
  };
  const resolveCurrentState = () => onResolveTextState?.() || state;
  const toggleInlineFlag = (key) => {
    const currentState = resolveCurrentState();
    onFormat?.({ [key]: nextStyleToggleValue(currentState?.[key]) });
  };
  const releaseToolbarSelection = (options) => onReleaseToolbarSelection?.(options);
  const releaseForBlurBehavior = (behavior) => {
    if (behavior === TOOLBAR_TRANSITION.HANDOFF) releaseToolbarSelection({ transition: TOOLBAR_TRANSITION.HANDOFF });
    else if (behavior === TOOLBAR_TRANSITION.BLOCK_SWITCH) releaseToolbarSelection({ transition: TOOLBAR_TRANSITION.BLOCK_SWITCH });
    else releaseToolbarSelection({ transition: TOOLBAR_TRANSITION.RESTORE });
  };
  const releaseFocusControl = (controlId, blurBehavior, { honorSkip = false } = {}) => {
    if (honorSkip && consumeSkipBlur(controlId)) return true;
    clearActiveToolbarControl(controlId);
    releaseForBlurBehavior(blurBehavior);
    return false;
  };
  const commitFontSize = (rawValue) => {
    const normalized = normalizeToolbarFontSizeValue(rawValue);
    if (normalized == null) return false;
    setSkipBlur("fontSize", true);
    clearActiveToolbarControl("fontSize");
    setFontSizeDraftValue(formatToolbarFontSizeValue(normalized));
    onFormat?.({ fontSize: normalized });
    return true;
  };
  const applyFontSizeWithBehavior = (rawValue, behavior) => {
    const normalized = normalizeToolbarFontSizeValue(rawValue);
    if (normalized == null) return false;
    setSkipBlur("fontSize", true);
    clearActiveToolbarControl("fontSize");
    setFontSizeDraftValue(formatToolbarFontSizeValue(normalized));
    const selectionTransitionAfterApply = behavior === TOOLBAR_TRANSITION.HANDOFF
      ? TOOLBAR_TRANSITION.HANDOFF
      : behavior === TOOLBAR_TRANSITION.BLOCK_SWITCH
        ? TOOLBAR_TRANSITION.BLOCK_SWITCH
        : TOOLBAR_TRANSITION.RESTORE;
    onFormat?.({ fontSize: normalized }, { selectionTransitionAfterApply });
    return true;
  };
  const commitFontSizeDraft = (rawValue, blurBehavior, { honorSkip = false } = {}) => {
    if (honorSkip && consumeSkipBlur("fontSize")) return true;
    if (String(rawValue).trim() === formatToolbarFontSizeValue(fontSizeValueRef.current)) {
      clearActiveToolbarControl("fontSize");
      setFontSizeDraftValue(formatToolbarFontSizeValue(fontSizeValueRef.current));
      releaseForBlurBehavior(blurBehavior);
      return false;
    }
    if (!applyFontSizeWithBehavior(rawValue, blurBehavior)) {
      clearActiveToolbarControl("fontSize");
      setFontSizeDraftValue(formatToolbarFontSizeValue(fontSizeValueRef.current));
      releaseForBlurBehavior(blurBehavior);
      return false;
    }
    return true;
  };
  const applyImmediateToolbarFormat = (controlId, patchValue, behavior = TOOLBAR_TRANSITION.RESTORE) => {
    setSkipBlur(controlId, true);
    clearActiveToolbarControl(controlId);
    onFormat?.(patchValue, { selectionTransitionAfterApply: behavior });
    return true;
  };
  const applyFontFamily = (nextValue, behavior = TOOLBAR_TRANSITION.RESTORE) => applyImmediateToolbarFormat("fontFamily", { fontFamily: nextValue }, behavior);
  const applyTextColor = (nextValue, behavior = TOOLBAR_TRANSITION.RESTORE) => applyImmediateToolbarFormat("textColor", { color: nextValue }, behavior);
  const nudgeFontSize = (delta) => {
    const currentState = resolveCurrentState();
    const baseSize = normalizeToolbarFontSizeValue(fontSizeDraft) ?? normalizeToolbarFontSizeValue(currentState?.fontSize) ?? fontSize;
    const nextSize = clampNumber(baseSize + delta, MIN_FONT_SIZE, MAX_FONT_SIZE);
    commitFontSize(nextSize);
  };
  useEffect(() => {
    setFontSizeDraftValue(formatToolbarFontSizeValue(fontSize));
  }, [fontSize, active, activeTextBlock?.id]);
  useEffect(() => {
    onRegisterToolbarController?.({
      commitPending: (blurBehavior = TOOLBAR_TRANSITION.RESTORE) => {
        if (!active) return false;
        const activeControl = toolbarControlStateRef.current.activeControl;
        if (activeControl === "fontSize") {
          const nextValue = fontSizeInputRef.current?.value ?? fontSizeDraftRef.current;
          return commitFontSizeDraft(nextValue, blurBehavior);
        }
        if (activeControl === "fontFamily") {
          return releaseFocusControl("fontFamily", blurBehavior);
        }
        if (activeControl === "textColor") {
          return releaseFocusControl("textColor", blurBehavior);
        }
        if (blurBehavior !== TOOLBAR_TRANSITION.BLOCK_SWITCH) {
          releaseForBlurBehavior(blurBehavior);
        }
        return false;
      },
    });
    return () => {
      onRegisterToolbarController?.(null);
    };
  }, [active, onRegisterToolbarController]);
  return (
    <div className="manuscript-toolbar" role="toolbar" aria-label="Manuscript toolbar">
      <div className="toolbar-group toolbar-actions" aria-label="File actions">
        <button type="button" className="toolbar-button toolbar-save" title="Save" aria-label="Save" onClick={() => onSave?.()}>Save</button>
        <button type="button" className="toolbar-button toolbar-icon-button" title="Undo" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>↶</button>
        <button type="button" className="toolbar-button toolbar-icon-button" title="Redo" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>↷</button>
      </div>
      <span className="toolbar-divider" aria-hidden="true" />
      <div className="toolbar-group toolbar-text-controls" aria-label="Text controls">
        <select
          ref={fontFamilySelectRef}
          className="toolbar-font-select"
          aria-label="Font"
          disabled={!active}
          value={state.fontFamily || activeTextBlock?.fontFamily || defaultFontFamily}
          onMouseDown={(event) => prepareToolbarFocusControl(event, "fontFamily")}
          onFocus={() => {
            setActiveToolbarControl("fontFamily");
            onPrepareToolbarSelection?.({ controlId: "fontFamily", focusBehavior: "preview" });
          }}
          onChange={(event) => applyFontFamily(event.target.value)}
          onBlur={(event) => {
            const blurBehavior = onResolveToolbarBlurBehavior?.(event.relatedTarget) || TOOLBAR_TRANSITION.RESTORE;
            releaseFocusControl("fontFamily", blurBehavior, { honorSkip: true });
          }}
        >
          {fontOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <div className="toolbar-size-control" role="group" aria-label="Font size controls">
          <button
            type="button"
            className="toolbar-size-button"
            aria-label="Decrease font size"
            title="Decrease font size"
            disabled={!active}
            onMouseDown={(event) => prepareToolbarButton(event, "fontSizeStepDown")}
            onClick={() => nudgeFontSize(-1)}
          >
            -
          </button>
          <input
            ref={fontSizeInputRef}
            aria-label="Font size"
            className="toolbar-size-input"
            type="number"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step="1"
            disabled={!active}
            value={fontSizeDraft}
            onMouseDown={(event) => prepareToolbarFocusControl(event, "fontSize")}
            onFocus={() => {
              setSkipBlur("fontSize", false);
              setActiveToolbarControl("fontSize");
              onPrepareToolbarSelection?.({ controlId: "fontSize", focusBehavior: "preview" });
            }}
            onChange={(event) => setFontSizeDraftValue(event.target.value)}
            onKeyDown={(event) => {
              const nextValue = event.currentTarget.value;
              if (event.key === "Enter") {
                event.preventDefault();
                if (!commitFontSize(nextValue)) {
                  setFontSizeDraftValue(formatToolbarFontSizeValue(fontSizeValueRef.current));
                  releaseToolbarSelection({ transition: TOOLBAR_TRANSITION.RESTORE });
                }
              } else if (event.key === "Escape") {
                event.preventDefault();
                clearActiveToolbarControl("fontSize");
                setFontSizeDraftValue(formatToolbarFontSizeValue(fontSizeValueRef.current));
                releaseToolbarSelection({ transition: TOOLBAR_TRANSITION.RESTORE });
              }
            }}
            onBlur={(event) => {
              const nextValue = event.currentTarget.value;
              const blurBehavior = onResolveToolbarBlurBehavior?.(event.relatedTarget) || TOOLBAR_TRANSITION.RESTORE;
              commitFontSizeDraft(nextValue, blurBehavior, { honorSkip: true });
            }}
          />
          <button
            type="button"
            className="toolbar-size-button"
            aria-label="Increase font size"
            title="Increase font size"
            disabled={!active}
            onMouseDown={(event) => prepareToolbarButton(event, "fontSizeStepUp")}
            onClick={() => nudgeFontSize(1)}
          >
            +
          </button>
        </div>
      </div>
      <span className="toolbar-divider" aria-hidden="true" />
      <div className="toolbar-group toolbar-style-controls" aria-label="Text style">
        <button type="button" className={`toolbar-button toolbar-icon-button ${styleIsActive(state.bold) ? "active" : ""} ${styleIsMixed(state.bold) ? "mixed" : ""}`} disabled={!active} title="Bold" aria-label="Bold" onMouseDown={(event) => prepareToolbarButton(event, "bold")} onClick={() => toggleInlineFlag("bold")}>B</button>
        <button type="button" className={`toolbar-button toolbar-icon-button toolbar-italic ${styleIsActive(state.italic) ? "active" : ""} ${styleIsMixed(state.italic) ? "mixed" : ""}`} disabled={!active} title="Italic" aria-label="Italic" onMouseDown={(event) => prepareToolbarButton(event, "italic")} onClick={() => toggleInlineFlag("italic")}>I</button>
        <button type="button" className={`toolbar-button toolbar-icon-button toolbar-underline ${styleIsActive(state.underline) ? "active" : ""} ${styleIsMixed(state.underline) ? "mixed" : ""}`} disabled={!active} title="Underline" aria-label="Underline" onMouseDown={(event) => prepareToolbarButton(event, "underline")} onClick={() => toggleInlineFlag("underline")}>U</button>
        <label className={`toolbar-color ${!active ? "disabled" : ""}`} title="Text color">
          <span className="toolbar-color-letter">A</span>
          <span className="toolbar-color-swatch" style={{ background: color }} aria-hidden="true" />
          <input
            ref={textColorInputRef}
            type="color"
            disabled={!active}
            value={color}
            onMouseDown={(event) => prepareToolbarFocusControl(event, "textColor")}
            onFocus={() => {
              setActiveToolbarControl("textColor");
              onPrepareToolbarSelection?.({ controlId: "textColor", focusBehavior: "preview" });
            }}
            onChange={(event) => applyTextColor(event.target.value)}
            onBlur={(event) => {
              const blurBehavior = onResolveToolbarBlurBehavior?.(event.relatedTarget) || TOOLBAR_TRANSITION.RESTORE;
              releaseFocusControl("textColor", blurBehavior, { honorSkip: true });
            }}
          />
        </label>
      </div>
      <span className="toolbar-divider" aria-hidden="true" />
      <div className="toolbar-group toolbar-align-controls" aria-label="Paragraph alignment">
        {["left", "center", "right"].map((value) => (
          <button
            type="button"
            key={value}
            className={`toolbar-button toolbar-icon-button ${align === value ? "active" : ""}`}
            disabled={!active}
            title={`Align ${value}`}
            aria-label={`Align ${value}`}
            onMouseDown={(event) => prepareToolbarButton(event, `align-${value}`)}
            onClick={() => onAlign?.(value)}
        >
          <AlignIcon align={value} />
        </button>
      ))}
      </div>
    </div>
  );
}

function AlignIcon({ align }) {
  return (
    <span className={`toolbar-align-icon ${align}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function CanvasOverview({ blocks, genericImports, chartSpecs, selectedBlockId, pages, canvasWidth, canvasHeight, onSelectBlock, onPageContextMenu }) {
  const safePages = normalizeManuscriptPages(pages, blocks);
  const overviewWidth = Math.max(CANVAS_WIDTH, Number(canvasWidth) || CANVAS_WIDTH);
  const overviewHeight = Math.max(EMPTY_CANVAS_HEIGHT, Number(canvasHeight) || 0);
  const snippet = (value, maxLength = 90) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  };
  const chartSummary = (block) => {
    const chartSpec = resolveChartSpecForBlock(block, chartSpecs);
    const proposal = chartSpec ? chartSpecToProposal(chartSpec) : null;
    const title = snippet(proposal?.title || chartSpec?.title, 72);
    return {
      title: title || "Missing chart spec",
      detail: proposal?.chartType || chartSpec?.chartType || block.chartSpecId || "chart",
    };
  };
  const overviewContent = (block) => {
    if (block.kind === "chart") {
      return <ChartOverviewPreview block={block} genericImports={genericImports} chartSpecs={chartSpecs} />;
    }
    if (block.kind === "text") {
      return <span>{snippet(plainTextFromTextRuns(block.textRuns)) || "Empty text box"}</span>;
    }
    if (block.kind === "image") {
      return block.dataUrl
        ? <img src={block.dataUrl} alt="" aria-hidden="true" />
        : <span>{snippet(block.name, 48) || "Image"}</span>;
    }
    return <span>Canvas block</span>;
  };
  const overviewLabel = (block) => {
    if (block.kind === "chart") {
      const summary = chartSummary(block);
      return `Chart: ${summary.title}${summary.detail ? ` (${summary.detail})` : ""}`;
    }
    if (block.kind === "text") return `Text: ${snippet(plainTextFromTextRuns(block.textRuns), 120) || "Empty text box"}`;
    if (block.kind === "image") return `Image: ${block.name || "uploaded image"}`;
    return "Canvas block";
  };
  return (
    <div className="canvas-overview" aria-label="Workspace overview">
      <div className="canvas-overview-page" style={{ aspectRatio: `${overviewWidth} / ${overviewHeight}` }}>
        {safePages.map((page, index) => (
          <button
            type="button"
            key={page.id}
            className="overview-page-band"
            style={{
              top: `${((page.y || 0) / overviewHeight) * 100}%`,
              width: `${((page.width || overviewWidth) / overviewWidth) * 100}%`,
              height: `${((page.height || 1) / overviewHeight) * 100}%`,
            }}
            aria-label={`Page ${index + 1}`}
            title={`Page ${index + 1}`}
            onContextMenu={(event) => onPageContextMenu?.(index, event)}
          >
            <span className="overview-page-number" aria-hidden="true">{index + 1}</span>
          </button>
        ))}
        {!blocks.length && <span className="overview-empty">No blocks yet</span>}
        {blocks.map((block) => {
          const style = {
            left: `${((block.x || 0) / overviewWidth) * 100}%`,
            top: `${((block.y || 0) / overviewHeight) * 100}%`,
            width: `${Math.max(2.5, ((block.w || 160) / overviewWidth) * 100)}%`,
            height: `${Math.max(1.8, ((block.h || 90) / overviewHeight) * 100)}%`,
          };
          return (
            <button
              key={block.id}
              className={`overview-block ${block.kind} ${selectedBlockId === block.id ? "active" : ""}`}
              style={style}
              title={overviewLabel(block)}
              aria-label={overviewLabel(block)}
              onClick={() => onSelectBlock(block)}
            >
              <span>{overviewContent(block)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChartOverviewPreview({ block, genericImports, chartSpecs }) {
  const chartSpec = resolveChartSpecForBlock(block, chartSpecs);
  if (!chartSpec) {
    return <div className="overview-chart-preview overview-missing-chart" aria-hidden="true">Missing chart spec</div>;
  }
  const chartLayout = resolveChartSpecBlockLayout(block, chartSpec);
  const plot = chartSpecBlockPlot(block, chartSpec, genericImports, { config: { staticPlot: true, displayModeBar: false } });
  const compactPlot = compactOverviewPlot(plot);
  const layerStyle = (layer) => ({
    left: `${((Number(layer?.x) || 0) / Math.max(1, Number(block.w) || 580)) * 100}%`,
    top: `${((Number(layer?.y) || 0) / Math.max(1, Number(block.h) || 380)) * 100}%`,
    width: `${((Number(layer?.width) || 1) / Math.max(1, Number(block.w) || 580)) * 100}%`,
    height: `${((Number(layer?.height) || 1) / Math.max(1, Number(block.h) || 380)) * 100}%`,
    fontSize: overviewFontSize(layer),
  });
  const textLayer = (section, className = "") => {
    const layer = chartLayout[section];
    if (!layer?.visible || !String(layer.text || "").trim()) return null;
    const rotated = Number(layer.rotation) || 0;
    return (
      <span className={`overview-chart-layer overview-chart-axis ${className}`} style={layerStyle(layer)}>
        <span style={{ transform: rotated ? `rotate(${rotated}deg)` : undefined }}>{layer.text}</span>
      </span>
    );
  };
  return (
    <div className="overview-chart-preview" aria-hidden="true">
      <span className="overview-chart-layer overview-chart-plot" style={layerStyle(chartLayout.plotArea)}>
        <Plot {...compactPlot} />
      </span>
      {textLayer("title", "overview-chart-title")}
      {chartLayout.legend?.visible && (
        <span className="overview-chart-layer overview-chart-legend" style={layerStyle(chartLayout.legend)}>
          <ChartLegendLayer layer={chartLayout.legend} traces={compactPlot.traces || []} />
        </span>
      )}
      {textLayer("xAxisTitle")}
      {textLayer("yAxisTitle")}
    </div>
  );
}

function compactOverviewPlot(plot) {
  const layout = plot.layout || {};
  const xaxis = layout.xaxis || {};
  const yaxis = layout.yaxis || {};
  return {
    ...plot,
    layout: {
      ...layout,
      autosize: true,
      margin: { l: 10, r: 2, t: 2, b: 10, pad: 0 },
      font: { ...(layout.font || {}), size: 5 },
      xaxis: {
        ...xaxis,
        automargin: false,
        title: { text: "" },
        tickfont: { ...(xaxis.tickfont || {}), size: 4 },
      },
      yaxis: {
        ...yaxis,
        automargin: false,
        title: { text: "" },
        tickfont: { ...(yaxis.tickfont || {}), size: 4 },
      },
    },
    config: {
      ...(plot.config || {}),
      displayModeBar: false,
      staticPlot: true,
      responsive: true,
    },
  };
}

function overviewFontSize(layer) {
  return Math.max(3, Math.min(8, Math.round((layer?.fontSize || 12) * 0.35)));
}

function ChartExperimentMappingValueCell({ cell }) {
  const value = cell?.value;
  if (value == null || value === "") return <span className="backend-scan-muted">-</span>;
  return <span>{value}</span>;
}

function ChartExperimentSelectorModal({ dataset, compatibleOptions, selectedExperimentIds, onApply, onClose }) {
  const [search, setSearch] = useState("");
  const [draftSelectedIds, setDraftSelectedIds] = useState(selectedExperimentIds);
  const rows = useMemo(() => buildGenericBrowserRows(dataset), [dataset]);
  const acceptedMappingColumns = useMemo(() => buildAcceptedMappingColumns(dataset?.genericMappingSets), [dataset?.genericMappingSets]);
  const compatibleIds = useMemo(() => new Set(compatibleOptions.map((option) => option.id)), [compatibleOptions]);
  const query = search.toLowerCase().trim();
  const filteredRows = useMemo(() => {
    if (!query) return rows;
    return rows.filter((row) => [
      row.label,
      row.sourceFile,
      row.sourceRange,
      row.mappingStatus,
      ...acceptedMappingColumns.map((column) => {
        const cell = row.acceptedMappingValues?.[column.key];
        return `${column.label} ${cell?.value || ""}`;
      }),
    ].join(" ").toLowerCase().includes(query));
  }, [acceptedMappingColumns, query, rows]);
  const draftSelectedSet = new Set(draftSelectedIds);
  const compatibleVisibleRows = filteredRows.filter((row) => row.experimentId && compatibleIds.has(row.experimentId));
  const selectedVisibleCount = compatibleVisibleRows.filter((row) => draftSelectedSet.has(row.experimentId)).length;
  const columnCount = 3 + acceptedMappingColumns.length;
  const toggleRow = (row) => {
    if (!row.experimentId || !compatibleIds.has(row.experimentId)) return;
    setDraftSelectedIds((current) => (
      current.includes(row.experimentId)
        ? current.filter((id) => id !== row.experimentId)
        : [...current, row.experimentId]
    ));
  };
  const selectCompatibleVisible = () => {
    setDraftSelectedIds((current) => [...new Set([
      ...current,
      ...compatibleVisibleRows.map((row) => row.experimentId).filter(Boolean),
    ])]);
  };
  const applySelection = () => {
    onApply(draftSelectedIds.filter((id) => compatibleIds.has(id)));
    onClose();
  };
  return (
    <div className="modal-backdrop picker-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide chart-experiment-selector-modal" role="dialog" aria-modal="true" aria-label="Select experiments">
        <div className="modal-head">
          <h2>Select experiments</h2>
          <button type="button" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="modal-body">
          <div className="chart-experiment-selector-tools">
            <label>
              Search
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Imported label, source, accepted mapping..." />
            </label>
            <div className="experiment-picker-counts">
              {selectedVisibleCount} of {compatibleVisibleRows.length} compatible visible selected &middot; {draftSelectedIds.length} selected
            </div>
          </div>
          <div className="experiment-picker-table-wrap chart-experiment-table-wrap">
            {!acceptedMappingColumns.length && (
              <div className="generic-browser-mapping-guidance">
                Accept semantic mappings in Import Review to turn reviewed fields into Experiment Browser columns.
              </div>
            )}
            <table className="experiment-picker-table chart-experiment-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Label</th>
                  <th>Source</th>
                  {acceptedMappingColumns.map((column) => (
                    <th key={column.key} title={column.rawLabel || column.label}>
                      <span>{column.label}</span>
                      {column.unit && <small> {column.unit}</small>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const compatible = !!row.experimentId && compatibleIds.has(row.experimentId);
                  return (
                    <tr
                      key={row.rowId}
                      className={`${draftSelectedSet.has(row.experimentId) ? "selected" : ""} ${compatible ? "" : "disabled"}`}
                      aria-disabled={!compatible}
                      onClick={() => toggleRow(row)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={draftSelectedSet.has(row.experimentId)}
                          disabled={!compatible}
                          aria-label={`Select ${row.label}`}
                          onChange={() => toggleRow(row)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </td>
                      <td>
                        <span>{row.label}</span>
                        {!compatible && <small>Not in this chart spec</small>}
                      </td>
                      <td><span>{row.sourceFile || "-"}</span><br /><small>{row.sourceRange || "range n/a"}</small></td>
                      {acceptedMappingColumns.map((column) => (
                        <td key={column.key} className="generic-mapped-cell">
                          <ChartExperimentMappingValueCell cell={row.acceptedMappingValues?.[column.key]} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {!filteredRows.length && (
                  <tr className="table-empty-row">
                    <td colSpan={columnCount}>No imported records match the current search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="experiment-picker-footer">
            <div className="experiment-picker-footer-left">
              <button type="button" onClick={selectCompatibleVisible} disabled={!compatibleVisibleRows.length}>Select compatible visible</button>
              <button type="button" onClick={() => setDraftSelectedIds([])}>Clear selection</button>
            </div>
            <button type="button" className="primary" onClick={applySelection}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsertChartModal({ draft, dataset, chartSpecs, genericImports, onPatch, onCancel, onInsert }) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const safeChartSpecs = normalizeChartSpecs(chartSpecs);
  const selectedChartSpec = safeChartSpecs.find((chartSpec) => chartSpec.id === draft.chartSpecId) || safeChartSpecs[0] || null;
  const experimentOptions = selectedChartSpec ? experimentOptionsForChartSpec(selectedChartSpec, genericImports) : [];
  const compatibleIds = new Set(experimentOptions.map((option) => option.id));
  const selectedExperimentIds = (Array.isArray(draft.selectedExperimentIds) ? draft.selectedExperimentIds : [])
    .map((id) => String(id || "").trim())
    .filter((id) => id && (!compatibleIds.size || compatibleIds.has(id)));
  const patchSelection = (ids) => onPatch({
    selectedExperimentIds: ids.filter((id) => !compatibleIds.size || compatibleIds.has(id)),
    excludedExperimentIds: ids.length ? [] : experimentOptions.map((option) => option.id),
  });
  const chartView = normalizeChartView({ ...draft, selectedExperimentIds });
  const canPreview = !!selectedChartSpec && (!experimentOptions.length || selectedExperimentIds.length > 0);
  const canInsert = !!selectedChartSpec && (!experimentOptions.length || selectedExperimentIds.length > 0);
  const plot = canPreview
    ? makeGenericChartPreview(selectedChartSpec, genericImports, { height: 260, chartView })
    : null;
  const selectChartSpec = (chartSpec) => {
    const options = experimentOptionsForChartSpec(chartSpec, genericImports);
    onPatch({
      chartSpecId: chartSpec.id,
      selectedExperimentIds: [],
      excludedExperimentIds: options.map((option) => option.id),
      filters: [],
      groupBy: null,
    });
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal insert-chart-modal" role="dialog" aria-modal="true" aria-label="Insert chart">
        <div className="modal-head">
          <h2>Insert approved chart</h2>
          <button onClick={onCancel} aria-label="Close">x</button>
        </div>
        <div className="modal-body">
          <section className="chart-modal-section">
            <div className="chart-modal-section-head">
              <div>
                <h3>Approved chart specs</h3>
                <p>{safeChartSpecs.length} available</p>
              </div>
            </div>
            {safeChartSpecs.length ? (
              <div className="chart-spec-choice-list">
                {safeChartSpecs.map((chartSpec) => (
                  <button
                    type="button"
                    key={chartSpec.id}
                    className={chartSpec.id === selectedChartSpec?.id ? "active" : ""}
                    onClick={() => selectChartSpec(chartSpec)}
                  >
                    <span>{chartSpec.title || "Untitled chart"}</span>
                    <small>{chartSpec.chartType || chartSpecToProposal(chartSpec).chartType || "chart"}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="chart-empty-message">Accept a backend chart proposal and create a chart spec before inserting charts into the manuscript.</p>
            )}
          </section>
          <section className="chart-modal-section">
            <div className="chart-modal-section-head">
              <div>
                <h3>Chart view</h3>
                <p>{experimentOptions.length ? `${selectedExperimentIds.length} of ${experimentOptions.length} experiments selected` : "No experiment filter available"}</p>
              </div>
              {experimentOptions.length > 0 && (
                <div className="chart-view-actions">
                  <button type="button" onClick={() => setSelectorOpen(true)}>
                    {selectedExperimentIds.length ? "Edit selection" : "Select experiments"}
                  </button>
                  <button type="button" onClick={() => patchSelection([])}>Clear</button>
                </div>
              )}
            </div>
            {experimentOptions.length ? (
              <div className="selected-experiment-summary">
                {selectedExperimentIds.length ? (
                  <div className="selected-experiment-strip">
                    {experimentOptions
                      .filter((option) => selectedExperimentIds.includes(option.id))
                      .map((option) => <span key={option.id}>{option.label}</span>)}
                  </div>
                ) : (
                  <p className="chart-empty-message">Select at least one compatible imported experiment before inserting this chart.</p>
                )}
              </div>
            ) : (
              <p className="chart-empty-message">This chart spec does not expose row-level experiment ids. It will render all available source values.</p>
            )}
          </section>
          <section className="chart-modal-section">
            <h3>Preview</h3>
            <div className="chart-insert-preview">
              {plot ? <Plot {...plot} /> : <div className="plot-empty">{selectedChartSpec ? "Select experiments to preview this chart." : "No chart spec selected."}</div>}
            </div>
          </section>
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="button" className="primary" disabled={!canInsert} onClick={onInsert}>Insert chart</button>
          </div>
        </div>
      </div>
      {selectorOpen && (
        <ChartExperimentSelectorModal
          dataset={dataset}
          compatibleOptions={experimentOptions}
          selectedExperimentIds={selectedExperimentIds}
          onApply={patchSelection}
          onClose={() => setSelectorOpen(false)}
        />
      )}
    </div>
  );
}

function ExportPptxModal({ pageCount, busy, error, onCancel, onExport }) {
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(pageCount || 1);
  useEffect(() => {
    setStartPage(1);
    setEndPage(pageCount || 1);
  }, [pageCount]);
  const clampPage = (value) => Math.max(1, Math.min(pageCount || 1, Number(value) || 1));
  const submit = (event) => {
    event.preventDefault();
    const start = clampPage(startPage);
    const end = Math.max(start, clampPage(endPage));
    onExport?.({ startPage: start, endPage: end });
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <form className="modal export-pptx-modal" role="dialog" aria-modal="true" aria-label="Export pages to PowerPoint" onSubmit={submit}>
        <div className="modal-head">
          <h2>Export pages to PowerPoint</h2>
          <button type="button" onClick={onCancel} aria-label="Close" disabled={busy}>x</button>
        </div>
        <div className="modal-body">
          <p className="export-note">Exports one manuscript page per slide using the LabRat default PowerPoint template. Text boxes and uploaded images stay editable; charts export as images to preserve layout and aspect ratio.</p>
          <div className="inspector-grid">
            <label>From page<input type="number" min="1" max={pageCount || 1} value={startPage} onChange={(e) => setStartPage(e.target.value)} disabled={busy} /></label>
            <label>To page<input type="number" min="1" max={pageCount || 1} value={endPage} onChange={(e) => setEndPage(e.target.value)} disabled={busy} /></label>
          </div>
          <div className="export-note">{pageCount} page{pageCount === 1 ? "" : "s"} available.</div>
          {error && <div className="source-error">{error}</div>}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !pageCount}>{busy ? "Exporting..." : "Export .pptx"}</button>
        </div>
      </form>
    </div>
  );
}

function PageOrientationModal({ onCancel, onChoose }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <section className="modal page-orientation-modal" role="dialog" aria-modal="true" aria-label="Choose manuscript orientation">
        <div className="modal-head">
          <h2>Choose page orientation</h2>
          <button type="button" onClick={onCancel} aria-label="Close">x</button>
        </div>
        <div className="modal-body">
          <p className="export-note">This locks the manuscript orientation. New pages will use this size and it cannot be changed later.</p>
          <div className="orientation-choice-grid">
            <button type="button" onClick={() => onChoose("landscape")}>
              <span className="orientation-preview landscape" />
              <span>Landscape</span>
              <small>1600 x 900</small>
            </button>
            <button type="button" onClick={() => onChoose("portrait")}>
              <span className="orientation-preview portrait" />
              <span>Portrait</span>
              <small>900 x 1600</small>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ExperimentPickerModal({ experiments, selectedLabels, onChangeLabels, onDone, onClose }) {
  const [search, setSearch] = useState("");
  const [qualityFilters, setQualityFilters] = useState({ cb95: false, hasPostGc: false, hasSweep: false, hasrate: false });
  const [filterBy, setFilterBy] = useState("all");
  const [filterValue, setFilterValue] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const cats = useMemo(() => [...new Set(experiments.map((e) => e.catalyst_type || "-"))].sort(), [experiments]);
  const imps = useMemo(() => [...new Set(experiments.map((e) => e.impeller || "-"))].sort(), [experiments]);
  const rpms = useMemo(() => [...new Set(experiments.map((e) => String(e.rpm ?? "-")))].sort((a, b) => Number(a) - Number(b)), [experiments]);
  const filterOptions = useMemo(() => getExperimentFilterOptions(filterBy, { cats, imps, rpms }), [filterBy, cats, imps, rpms]);
  const visibleExperiments = useMemo(() => {
    const q = search.toLowerCase().trim();
    return experiments
      .filter((experiment) => experimentMatchesSearch(experiment, q))
      .filter((experiment) => experimentMatchesQualityFilters(experiment, qualityFilters))
      .filter((experiment) => experimentMatchesFilter(experiment, filterBy, filterValue))
      .sort((a, b) => compareExperimentDates(a, b, sortOrder));
  }, [experiments, search, qualityFilters, filterBy, filterValue, sortOrder]);
  const selectedSet = new Set(selectedLabels);
  const selectedVisibleCount = visibleExperiments.filter((experiment) => selectedSet.has(experiment.label)).length;
  const updateFilterBy = (value) => {
    setFilterBy(value);
    setFilterValue("all");
  };
  const updateQualityFilter = (key, checked) => {
    setQualityFilters((current) => ({ ...current, [key]: checked }));
  };
  const clearFilters = () => {
    setSearch("");
    setQualityFilters({ cb95: false, hasPostGc: false, hasSweep: false, hasrate: false });
    setFilterBy("all");
    setFilterValue("all");
    setSortOrder("newest");
  };
  const toggleLabel = (label) => {
    onChangeLabels(selectedSet.has(label) ? selectedLabels.filter((item) => item !== label) : [...selectedLabels, label]);
  };
  const selectAllVisible = () => {
    const next = new Set(selectedLabels);
    visibleExperiments.forEach((experiment) => next.add(experiment.label));
    onChangeLabels([...next]);
  };
  const clearSelection = () => {
    onChangeLabels([]);
  };
  return (
    <div className="modal-backdrop picker-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide experiment-picker-modal" role="dialog" aria-modal="true" aria-label="Select experiments for chart">
        <div className="modal-head">
          <h2>Select experiments for chart</h2>
          <button onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="modal-body">
          <div className="experiment-picker-tools">
            <label>
              Search
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Label, comments..." />
            </label>
            <label>
              Sort
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
            <label>
              Filter by variable
              <select value={filterBy} onChange={(e) => updateFilterBy(e.target.value)}>
                <option value="all">All experiments</option>
                <option value="cat">Catalyst</option>
                <option value="impeller">Impeller</option>
                <option value="rpm">RPM</option>
                <option value="cb95">Carbon balance</option>
                <option value="hasrate">Rate data</option>
              </select>
            </label>
          </div>
          <div className="experiment-picker-checks">
            <label><input type="checkbox" checked={qualityFilters.cb95} onChange={(e) => updateQualityFilter("cb95", e.target.checked)} /> Carbon balance &gt;= 95%</label>
            <label><input type="checkbox" checked={qualityFilters.hasPostGc} onChange={(e) => updateQualityFilter("hasPostGc", e.target.checked)} /> Has post-rxn GC data</label>
            <label><input type="checkbox" checked={qualityFilters.hasSweep} onChange={(e) => updateQualityFilter("hasSweep", e.target.checked)} /> Has sweep data</label>
            <label><input type="checkbox" checked={qualityFilters.hasrate} onChange={(e) => updateQualityFilter("hasrate", e.target.checked)} /> Has rate data</label>
            <button type="button" onClick={clearFilters}>Clear filters</button>
          </div>
          <label className="experiment-filter-value">
            Filter
            <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)} disabled={filterBy === "all"}>
              {filterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="experiment-picker-counts">
            {selectedVisibleCount} of {visibleExperiments.length} visible &middot; {selectedLabels.length} selected
          </div>
          <div className="experiment-picker-table-wrap">
            <table className="experiment-picker-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Label</th>
                  <th>Date</th>
                  <th>CAT (g)</th>
                  <th>HDPE (g)</th>
                  <th>T (&deg;C)</th>
                  <th>P (bar)</th>
                  <th>t (h)</th>
                  <th>RPM</th>
                  <th>Impeller</th>
                  <th>Conv %</th>
                  <th>Sel S/L/G</th>
                  <th>C-Bal %</th>
                  <th>Catalyst</th>
                </tr>
              </thead>
              <tbody>
                {visibleExperiments.map((experiment) => (
                  <tr key={experiment.label} onClick={() => toggleLabel(experiment.label)} className={selectedSet.has(experiment.label) ? "selected" : ""}>
                    <td><input type="checkbox" checked={selectedSet.has(experiment.label)} onChange={() => toggleLabel(experiment.label)} onClick={(e) => e.stopPropagation()} /></td>
                    <td><span>{experiment.label}</span></td>
                    <td>{experiment.date || "-"}</td>
                    <td>{fmt(experiment.catalyst_loading_g, 3)}</td>
                    <td>{fmt(experiment.polymer_loading_g, 2)}</td>
                    <td>{fmt(experiment.temperature_C, 0)}</td>
                    <td>{fmt(experiment.pressure_bar, 0)}</td>
                    <td>{fmt(experiment.reaction_time_hr, 1)}</td>
                    <td>{fmt(experiment.rpm, 0)}</td>
                    <td>{experiment.impeller || "-"}</td>
                    <td>{fmt(experiment.conversion_pct, 1)}</td>
                    <td>{fmt(experiment.selectivity_solid_pct, 1)} / {fmt(experiment.selectivity_liquid_pct, 1)} / {fmt(experiment.selectivity_gas_pct, 1)}</td>
                    <td>{fmt(experiment.carbon_balance_pct, 1)}</td>
                    <td>{experiment.catalyst_type || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="experiment-picker-footer">
            <div className="experiment-picker-footer-left">
              <button type="button" onClick={selectAllVisible}>Select all visible</button>
              <button type="button" onClick={clearSelection}>Clear selection</button>
            </div>
            <button type="button" className="primary" onClick={onDone}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function experimentMatchesSearch(experiment, search) {
  if (!search) return true;
  return `${experiment.label} ${experiment.comments || ""}`.toLowerCase().includes(search);
}

function hasPostReactionGc(experiment) {
  return !!(experiment.calculation || experiment.files?.calculation || experiment.sources?.some((source) => source.kind === "post_reaction_gc"));
}

function hasSweepData(experiment) {
  return !!(experiment.sweep || experiment.files?.sweep || experiment.sources?.some((source) => source.kind === "sweep_gc"));
}

function experimentMatchesQualityFilters(experiment, filters) {
  if (filters.cb95 && !(experiment.carbon_balance_pct >= 95)) return false;
  if (filters.hasPostGc && !hasPostReactionGc(experiment)) return false;
  if (filters.hasSweep && !hasSweepData(experiment)) return false;
  if (filters.hasrate && !experiment.rate_sources?.length) return false;
  return true;
}

function getExperimentFilterOptions(filterBy, { cats, imps, rpms }) {
  if (filterBy === "cat") return [["all", "All catalysts"], ...cats.map((value) => [value, value])];
  if (filterBy === "impeller") return [["all", "All impellers"], ...imps.map((value) => [value, value])];
  if (filterBy === "rpm") return [["all", "All RPM values"], ...rpms.map((value) => [value, value])];
  if (filterBy === "cb95") return [["all", "Any carbon balance"], ["yes", "Carbon balance >= 95%"], ["no", "Carbon balance < 95%"]];
  if (filterBy === "hasrate") return [["all", "Any rate data state"], ["yes", "Has rate data"], ["no", "No rate data"]];
  return [["all", "All experiments"]];
}

function experimentMatchesFilter(experiment, filterBy, filterValue) {
  if (filterBy === "all" || filterValue === "all") return true;
  if (filterBy === "cat") return (experiment.catalyst_type || "-") === filterValue;
  if (filterBy === "impeller") return (experiment.impeller || "-") === filterValue;
  if (filterBy === "rpm") return String(experiment.rpm ?? "-") === filterValue;
  if (filterBy === "cb95") return filterValue === "yes" ? experiment.carbon_balance_pct >= 95 : !(experiment.carbon_balance_pct >= 95);
  if (filterBy === "hasrate") return filterValue === "yes" ? !!experiment.rate_sources?.length : !experiment.rate_sources?.length;
  return true;
}

function compareExperimentDates(a, b, sortOrder) {
  const aTime = experimentDateSortValue(a.date);
  const bTime = experimentDateSortValue(b.date);
  return sortOrder === "oldest" ? aTime - bTime : bTime - aTime;
}

function ChartAssistBubble({ block, canvasWidth, canvasHeight, logoSrc, onClick, onClose }) {
  const bubbleWidth = 244;
  const gap = 12;
  const rightSideLeft = (block.x || 0) + (block.w || 0) + gap;
  const fitsRight = rightSideLeft + bubbleWidth <= Math.max(CANVAS_WIDTH, canvasWidth || 0);
  const left = fitsRight ? rightSideLeft : Math.max(8, (block.x || 0) - bubbleWidth - gap);
  const top = Math.max(8, Math.min((block.y || 0) + 18, Math.max(8, canvasHeight - 60)));
  return (
    <div
      role="button"
      tabIndex={0}
      className={`chart-assist-bubble ${fitsRight ? "" : "left-side"}`}
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onClick?.();
      }}
    >
      <button
        type="button"
        className="chart-assist-close"
        aria-label="Close chart assist"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose?.();
        }}
      >
        x
      </button>
      <img src={logoSrc} alt="" />
      <span>Let me help you write an analysis</span>
    </div>
  );
}

function CanvasBlock({ genericImports, chartSpecs, block, canvasWidth, canvasHeight, selectedKey, setSelected, patch, patchTextRuns, remove, editingTextBoxId, setEditingTextBoxId, richTextApiRef, onTextToolbarChange, onBeginTextEdit, onCommitTextEdit, onBeginTransaction, onCommitTransaction, onUndo, onRedo, onChartContextMenu, onBlockContextMenu }) {
  const blockSelected = selectedKey === block.id;
  const chartSpec = block.kind === "chart" ? resolveChartSpecForBlock(block, chartSpecs) : null;
  const isEditingText = block.kind === "text" && editingTextBoxId === block.id;
  const textBoxStyle = block.kind === "text" ? textBlockStyle(block) : null;
  const patchOuterFrame = (next, options = {}) => {
    const nextPatch = { x: next.x, y: next.y, w: next.width, h: next.height };
    if (block.kind === "chart" && chartSpec) {
      const prevSize = { width: Math.max(1, Number(block.w) || 580), height: Math.max(1, Number(block.h) || 380) };
      const nextSize = { width: Math.max(1, Number(next.width) || prevSize.width), height: Math.max(1, Number(next.height) || prevSize.height) };
      if (prevSize.width !== nextSize.width || prevSize.height !== nextSize.height) {
        nextPatch.chartLayout = scaleChartLayout(resolveChartSpecBlockLayout(block, chartSpec), prevSize, nextSize);
      }
    }
    patch(block.id, nextPatch, options);
  };
  let body = null;
  if (block.kind === "chart") {
    const chartLayout = chartSpec ? resolveChartSpecBlockLayout(block, chartSpec) : null;
    const plot = chartSpec ? chartSpecBlockPlot(block, chartSpec, genericImports) : null;
    const layerKey = (section, mode = "") => `${block.id}:${section}${mode ? `:${mode}` : ""}`;
    const layerSelected = (section) => selectedKey === layerKey(section) || selectedKey === layerKey(section, "edit");
    const layerEditing = (section) => selectedKey === layerKey(section, "edit");
    const patchLayer = (section, next, options = {}) => {
      if (!chartSpec) return;
      patch(block.id, patchChartSpecBlockLayout(block, chartSpec, section, {
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
      }), options);
    };
    const patchLayerText = (section, text) => {
      if (!chartSpec) return;
      patch(block.id, patchChartSpecBlockLayout(block, chartSpec, section, { text }), { transactionType: "chart-layer-text" });
    };
    const layerFrame = (section, layer, child, minWidth = 24, minHeight = 18, className = "") => {
      if (!layer?.visible && section !== "plotArea") return null;
      return (
        <SelectionFrame
          key={section}
          selected={layerSelected(section)}
          x={layer.x || 0}
          y={layer.y || 0}
          width={layer.width || minWidth}
          height={layer.height || minHeight}
          minWidth={minWidth}
          minHeight={minHeight}
          bounds={{ width: Math.max(1, Number(block.w) || 580), height: Math.max(1, Number(block.h) || 380) }}
          className={`chart-layer ${className}`}
          onSelect={() => {
            setSelected(layerKey(section));
            setEditingTextBoxId?.(null);
          }}
          onChange={(next, options) => patchLayer(section, next, options)}
          onMoveStart={() => onBeginTransaction?.("chart-layer-move", { blockId: block.id, section })}
          onMoveEnd={() => onCommitTransaction?.()}
          onResizeStart={() => onBeginTransaction?.("chart-layer-resize", { blockId: block.id, section })}
          onResizeEnd={() => onCommitTransaction?.()}
          onUndo={onUndo}
          onRedo={onRedo}
        >
          {child}
        </SelectionFrame>
      );
    };
    body = plot
      ? (
        <div className="chart-spec-canvas">
          {layerFrame("plotArea", chartLayout.plotArea, (
            <div className="chart-plot-area">
              <Plot {...plot} />
            </div>
          ), 160, 110, "chart-plot-layer")}
          {layerFrame("title", chartLayout.title, (
            <ChartTextLayer
              section="title"
              layer={chartLayout.title}
              className="chart-title-layer"
              editing={layerEditing("title")}
              onBeginEdit={() => setSelected(layerKey("title", "edit"))}
              onEndEdit={() => setSelected(layerKey("title"))}
              onChangeText={patchLayerText}
            />
          ), 60, 22, "chart-title-frame")}
          {layerFrame("legend", chartLayout.legend, (
            <ChartLegendLayer layer={chartLayout.legend} traces={plot.traces || []} />
          ), 80, 24, "chart-legend-frame")}
          {layerFrame("xAxisTitle", chartLayout.xAxisTitle, (
            <ChartTextLayer
              section="xAxisTitle"
              layer={chartLayout.xAxisTitle}
              className="chart-axis-title"
              editing={layerEditing("xAxisTitle")}
              onBeginEdit={() => setSelected(layerKey("xAxisTitle", "edit"))}
              onEndEdit={() => setSelected(layerKey("xAxisTitle"))}
              onChangeText={patchLayerText}
            />
          ), 60, 22, "chart-x-axis-frame")}
          {layerFrame("yAxisTitle", chartLayout.yAxisTitle, (
            <ChartTextLayer
              section="yAxisTitle"
              layer={chartLayout.yAxisTitle}
              className="chart-axis-title"
              editing={layerEditing("yAxisTitle")}
              onBeginEdit={() => setSelected(layerKey("yAxisTitle", "edit"))}
              onEndEdit={() => setSelected(layerKey("yAxisTitle"))}
              onChangeText={patchLayerText}
            />
          ), 40, 22, "chart-y-axis-frame")}
        </div>
      )
      : <div className="plot-empty chart-spec-missing">Missing chart spec. Create or reload the approved chart before exporting.</div>;
  } else if (block.kind === "text") {
    body = (
      <RichTextBox
        block={block}
        editing={isEditingText}
        patchTextRuns={patchTextRuns}
        richTextApiRef={richTextApiRef}
        onToolbarChange={onTextToolbarChange}
        onBeginEdit={(event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          onBeginTextEdit?.(block.id);
          setSelected(block.id);
          setEditingTextBoxId?.(block.id);
        }}
        onEndEdit={() => {
          onCommitTextEdit?.();
          setEditingTextBoxId?.(null);
        }}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    );
  } else {
    body = <img src={block.dataUrl} alt={block.name || ""} />;
  }
  return (
    <SelectionFrame
      selected={blockSelected}
      x={block.x ?? 0}
      y={block.y ?? 0}
      width={block.w ?? 160}
      height={block.h ?? 90}
      minWidth={160}
      minHeight={90}
      bounds={{ width: Math.max(CANVAS_WIDTH, canvasWidth), height: Math.max(EMPTY_CANVAS_HEIGHT, canvasHeight) }}
      className={`canvas-block ${block.kind} ${isEditingText ? "is-editing-text" : ""}`}
      style={textBoxStyle}
      onSelect={() => {
        if (editingTextBoxId && editingTextBoxId !== block.id) onCommitTextEdit?.();
        setSelected(block.id);
        if (block.kind !== "text") setEditingTextBoxId?.(null);
      }}
      onChange={patchOuterFrame}
      onMoveStart={() => onBeginTransaction?.("block-move", { blockId: block.id })}
      onMoveEnd={() => onCommitTransaction?.()}
      onResizeStart={() => onBeginTransaction?.("block-resize", { blockId: block.id })}
      onResizeEnd={() => onCommitTransaction?.()}
      onDelete={() => remove(block.id)}
      disableKeyboardDelete={isEditingText}
      onUndo={onUndo}
      onRedo={onRedo}
      onContextMenu={block.kind === "chart" ? (e) => onChartContextMenu?.(block, e) : (e) => onBlockContextMenu?.(block, e)}
    >
      <div className="block-actions"><button type="button" aria-label={`Delete ${block.kind} block`} onClick={() => remove(block.id)}>×</button></div>
      {body}
    </SelectionFrame>
  );
}

function RichTextBox({ block, editing, patchTextRuns, richTextApiRef, onToolbarChange, onBeginEdit, onEndEdit, onUndo, onRedo }) {
  const rootRef = useRef(null);
  const pendingSelectionRef = useRef(null);
  const pendingInsertStyleRef = useRef(inlineStyleFromState(runStyleAt(block.textRuns, null, block), block));
  const restoreSelectionFrameRef = useRef(null);
  const toolbarInteractionRef = useRef(false);
  const pointerTargetKindRef = useRef("external");
  const [selectionMode, setSelectionModeState] = useState(SELECTION_MODE.EDITOR_ACTIVE);
  const selectionModeRef = useRef(SELECTION_MODE.EDITOR_ACTIVE);
  const textRuns = normalizeTextRuns(block.textRuns, block);
  const setSelectionMode = (nextMode) => {
    selectionModeRef.current = nextMode;
    setSelectionModeState(nextMode);
  };
  const currentSelectionMode = () => selectionModeRef.current;
  const selectionFromDom = () => {
    const root = rootRef.current;
    const selection = window.getSelection?.();
    if (!root || !selection || !selection.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
    return {
      start: domPointToTextPosition(root, selection.anchorNode, selection.anchorOffset),
      end: domPointToTextPosition(root, selection.focusNode, selection.focusOffset),
    };
  };
  const setSelection = (selection) => {
    pendingSelectionRef.current = orderTextSelection(selection) || selection;
  };
  const lastKnownSelection = () => selectionFromDom() || pendingSelectionRef.current;
  const classifyInteractionTarget = (target) => {
    const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    if (!element) return "external";
    if (element.closest(".manuscript-toolbar")) return "toolbar";
    const currentFrame = rootRef.current?.closest(".selection-frame");
    const targetFrame = element.closest(".selection-frame");
    if (currentFrame && targetFrame === currentFrame) return "same-text-box";
    if (element.closest(".canvas") && !element.closest(".canvas-block")) return "empty-canvas";
    if (element.closest(".canvas-block")) return "other-block";
    return "external";
  };
  const clearScheduledSelectionRestore = () => {
    if (restoreSelectionFrameRef.current != null) {
      window.cancelAnimationFrame(restoreSelectionFrameRef.current);
      restoreSelectionFrameRef.current = null;
    }
  };
  const restoreEditorFocus = () => {
    const root = rootRef.current;
    if (!root || !root.isConnected) return false;
    try {
      root.focus({ preventScroll: true });
      return true;
    } catch {
      try {
        root.focus();
        return true;
      } catch {
        return false;
      }
    }
  };
  const beginSelectionRestore = (selection) => {
    setSelection(selection);
    const shouldDeferFocus = currentSelectionMode() === SELECTION_MODE.TOOLBAR_PREVIEW || currentSelectionMode() === SELECTION_MODE.RESTORING;
    if (!shouldDeferFocus) {
      setSelectionMode(SELECTION_MODE.EDITOR_ACTIVE);
      toolbarInteractionRef.current = false;
      updateToolbarState();
      return;
    }
    setSelectionMode(SELECTION_MODE.RESTORING);
    clearScheduledSelectionRestore();
    restoreSelectionFrameRef.current = window.requestAnimationFrame(() => {
      restoreSelectionFrameRef.current = null;
      const root = rootRef.current;
      if (!restoreEditorFocus() || !root) {
        toolbarInteractionRef.current = false;
        setSelectionMode(SELECTION_MODE.EDITOR_ACTIVE);
        updateToolbarState();
        return;
      }
      const nextSelection = pendingSelectionRef.current || orderTextSelection(selection) || selection;
      if (nextSelection) restoreDomSelection(root, nextSelection);
      setSelectionMode(SELECTION_MODE.EDITOR_ACTIVE);
      updateToolbarState();
      toolbarInteractionRef.current = false;
    });
  };
  const enterToolbarPreview = (selection) => {
    if (!selection || isCollapsedSelection(selection)) {
      setSelectionMode(SELECTION_MODE.EDITOR_ACTIVE);
      return;
    }
    setSelectionMode(SELECTION_MODE.TOOLBAR_PREVIEW);
    window.getSelection?.()?.removeAllRanges?.();
  };
  const prepareToolbarSelection = ({ focusBehavior = "preview" } = {}) => {
    toolbarInteractionRef.current = true;
    const selection = lastKnownSelection();
    if (selection) setSelection(selection);
    if (focusBehavior === "preview") {
      enterToolbarPreview(selection);
      return selection;
    }
    if (currentSelectionMode() === SELECTION_MODE.TOOLBAR_PREVIEW || currentSelectionMode() === SELECTION_MODE.RESTORING) {
      return selection;
    }
    setSelectionMode(SELECTION_MODE.EDITOR_ACTIVE);
    if (selection && restoreEditorFocus()) {
      restoreDomSelection(rootRef.current, selection);
    }
    return selection;
  };
  const resolveToolbarState = (selection = lastKnownSelection()) => {
    if (selection) setSelection(selection);
    if (selection && isCollapsedSelection(selection)) {
      const caretStyle = runStyleAt(block.textRuns, selection, block);
      const pendingStyle = pendingInsertStyleRef.current || inlineStyleFromState(caretStyle, block);
      return { ...caretStyle, ...pendingStyle, active: editing };
    }
    const style = summarizeInlineStyle(block.textRuns, selection, block);
    return { ...style, active: editing };
  };
  const updateToolbarState = () => {
    onToolbarChange?.(resolveToolbarState());
  };
  const finalizeToolbarSelection = (selection, transition = TOOLBAR_TRANSITION.RESTORE) => {
    const orderedSelection = orderTextSelection(selection) || selection;
    if (transition === TOOLBAR_TRANSITION.RESTORE) {
      beginSelectionRestore(orderedSelection);
      return;
    }
    setSelection(orderedSelection);
    toolbarInteractionRef.current = false;
    if (transition === TOOLBAR_TRANSITION.HANDOFF) {
      enterToolbarPreview(orderedSelection);
      updateToolbarState();
      return;
    }
    setSelectionMode(SELECTION_MODE.NONE);
    onToolbarChange?.(null);
    onEndEdit?.();
  };
  const commitTextRuns = (nextTextRuns, nextSelection, historyMode = "commit", transactionType = "text-edit") => {
    const normalized = normalizeTextRuns(nextTextRuns, block);
    setSelection(nextSelection);
    patchTextRuns?.(block.id, normalized, { history: historyMode, transactionType });
  };
  const insertText = (text, historyMode = "batch") => {
    const selection = lastKnownSelection() || { start: { p: 0, offset: 0 }, end: { p: 0, offset: 0 } };
    const insertionStyle = isCollapsedSelection(selection)
      ? (pendingInsertStyleRef.current || inlineStyleFromState(runStyleAt(block.textRuns, selection, block), block))
      : runStyleAt(block.textRuns, selection, block);
    const result = insertTextAtSelection(block.textRuns, selection, text, insertionStyle, block);
    pendingInsertStyleRef.current = inlineStyleFromState(insertionStyle, block);
    commitTextRuns(result.textRuns, result.selection, historyMode);
  };
  const api = {
    prepareToolbarSelection,
    releaseToolbarSelection: ({ transition = TOOLBAR_TRANSITION.RESTORE } = {}) => {
      const selection = lastKnownSelection();
      if (!selection && transition === TOOLBAR_TRANSITION.RESTORE) {
        toolbarInteractionRef.current = false;
        setSelectionMode(SELECTION_MODE.EDITOR_ACTIVE);
        updateToolbarState();
        return;
      }
      finalizeToolbarSelection(selection, transition);
    },
    ownsToolbarSelection: () => {
      const mode = currentSelectionMode();
      return mode === SELECTION_MODE.TOOLBAR_PREVIEW || mode === SELECTION_MODE.RESTORING;
    },
    resolveToolbarBlurBehavior: (relatedTarget) => {
      const relatedKind = relatedTarget ? classifyInteractionTarget(relatedTarget) : null;
      const targetKind = relatedKind && relatedKind !== "external" ? relatedKind : pointerTargetKindRef.current;
      if (targetKind === "toolbar") return TOOLBAR_TRANSITION.HANDOFF;
      if (targetKind === "other-block") return TOOLBAR_TRANSITION.BLOCK_SWITCH;
      return TOOLBAR_TRANSITION.RESTORE;
    },
    getToolbarState: () => resolveToolbarState(),
    formatInline: (patchValue, { selectionTransitionAfterApply = TOOLBAR_TRANSITION.RESTORE } = {}) => {
      const selection = lastKnownSelection();
      if (!selection) return;
      const orderedSelection = orderTextSelection(selection) || selection;
      if (isCollapsedSelection(selection)) {
        pendingInsertStyleRef.current = inlineStyleFromState({ ...pendingInsertStyleRef.current, ...patchValue }, block);
        onToolbarChange?.({ ...runStyleAt(block.textRuns, selection, block), ...pendingInsertStyleRef.current, active: editing });
        finalizeToolbarSelection(orderedSelection, selectionTransitionAfterApply);
        return;
      }
      const next = applyInlineFormat(block.textRuns, selection, patchValue, block);
      commitTextRuns(next, orderedSelection, "commit", "text-format");
      finalizeToolbarSelection(orderedSelection, selectionTransitionAfterApply);
    },
    alignParagraphs: (align) => {
      const selection = lastKnownSelection() || { start: { p: 0, offset: 0 }, end: { p: 0, offset: 0 } };
      const next = applyParagraphAlign(block.textRuns, selection, align, block);
      const orderedSelection = orderTextSelection(selection) || selection;
      commitTextRuns(next, orderedSelection, "commit", "text-format");
      onToolbarChange?.({ ...runStyleAt(block.textRuns, selection, block), align, active: editing });
      beginSelectionRestore(orderedSelection);
    },
  };
  useEffect(() => {
    if (editing) richTextApiRef.current = api;
    return () => {
      if (richTextApiRef.current === api) richTextApiRef.current = null;
    };
  });
  useLayoutEffect(() => {
    if (!editing) return;
    if (selectionMode === SELECTION_MODE.TOOLBAR_PREVIEW || selectionMode === SELECTION_MODE.RESTORING) {
      updateToolbarState();
      return;
    }
    if (selectionMode === SELECTION_MODE.NONE) return;
    const root = rootRef.current;
    restoreEditorFocus();
    const nextSelection = pendingSelectionRef.current;
    if (nextSelection) restoreDomSelection(root, nextSelection);
    if (!nextSelection || isCollapsedSelection(nextSelection)) {
      pendingInsertStyleRef.current = inlineStyleFromState(runStyleAt(block.textRuns, nextSelection, block), block);
    }
    updateToolbarState();
  }, [editing, block.textRuns, selectionMode]);
  useEffect(() => {
    if (!editing) return undefined;
    const handleMouseDownCapture = (event) => {
      pointerTargetKindRef.current = classifyInteractionTarget(event.target);
    };
    const handleSelectionChange = () => {
      if (toolbarInteractionRef.current) return;
      const selection = selectionFromDom();
      if (!selection) return;
      setSelection(selection);
      setSelectionMode(SELECTION_MODE.EDITOR_ACTIVE);
      if (isCollapsedSelection(selection)) {
        pendingInsertStyleRef.current = inlineStyleFromState(runStyleAt(block.textRuns, selection, block), block);
      }
      updateToolbarState();
    };
    document.addEventListener("mousedown", handleMouseDownCapture, true);
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("mousedown", handleMouseDownCapture, true);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [editing, block.textRuns]);
  useEffect(() => {
    if (!editing) {
      setSelectionMode(SELECTION_MODE.NONE);
      return;
    }
    setSelectionMode(SELECTION_MODE.EDITOR_ACTIVE);
  }, [editing, block.id]);
  useEffect(() => () => {
    clearScheduledSelectionRestore();
  }, []);
  if (!editing) {
    return (
      <div
        className="text-box-display rich-text-display"
        onDoubleClick={onBeginEdit}
      >
        <RichTextContent textRuns={textRuns} block={block} />
      </div>
    );
  }
  return (
    <div
      ref={rootRef}
      className={`rich-text-editor ${selectionMode === SELECTION_MODE.TOOLBAR_PREVIEW ? "has-inactive-selection-preview" : ""}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onMouseDown={(event) => {
        if (selectionMode === SELECTION_MODE.TOOLBAR_PREVIEW || selectionMode === SELECTION_MODE.RESTORING) {
          event.preventDefault();
          event.stopPropagation();
          api.releaseToolbarSelection({ transition: TOOLBAR_TRANSITION.RESTORE });
          return;
        }
        event.stopPropagation();
      }}
      onMouseUp={updateToolbarState}
      onKeyUp={updateToolbarState}
      onFocus={() => {
        setSelectionMode(SELECTION_MODE.EDITOR_ACTIVE);
        updateToolbarState();
      }}
      onBlur={(event) => {
        if (
          toolbarInteractionRef.current
          || event.relatedTarget?.closest?.(".manuscript-toolbar")
          || currentSelectionMode() === SELECTION_MODE.TOOLBAR_PREVIEW
          || currentSelectionMode() === SELECTION_MODE.RESTORING
        ) return;
        onToolbarChange?.(null);
        onEndEdit?.();
      }}
      onPaste={(event) => {
        event.preventDefault();
        event.stopPropagation();
        insertText(event.clipboardData.getData("text/plain"), "commit");
      }}
      onBeforeInput={(event) => {
        const type = event.nativeEvent.inputType;
        if (event.nativeEvent.isComposing) return;
        if (type === "historyUndo") {
          event.preventDefault();
          onUndo?.();
        } else if (type === "historyRedo") {
          event.preventDefault();
          onRedo?.();
        } else if (type === "insertText") {
          event.preventDefault();
          insertText(event.nativeEvent.data || "", "batch");
        } else if (type === "insertParagraph" || type === "insertLineBreak") {
          event.preventDefault();
          insertText("\n", "commit");
        } else if (type === "deleteContentBackward") {
          event.preventDefault();
          const result = deleteBackward(block.textRuns, selectionFromDom(), block);
          commitTextRuns(result.textRuns, result.selection, "commit");
        } else if (type === "deleteContentForward") {
          event.preventDefault();
          const result = deleteForward(block.textRuns, selectionFromDom(), block);
          commitTextRuns(result.textRuns, result.selection, "commit");
        }
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent?.isComposing) return;
        const key = event.key.toLowerCase();
        const usesShortcutModifier = event.ctrlKey || event.metaKey;
        if (usesShortcutModifier && key === "z") {
          event.preventDefault();
          if (event.shiftKey) onRedo?.();
          else onUndo?.();
          return;
        }
        if (usesShortcutModifier && key === "y") {
          event.preventDefault();
          onRedo?.();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          insertText("\n", "commit");
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          const result = deleteBackward(block.textRuns, selectionFromDom(), block);
          commitTextRuns(result.textRuns, result.selection, "commit");
          return;
        }
        if (event.key === "Delete") {
          event.preventDefault();
          const result = deleteForward(block.textRuns, selectionFromDom(), block);
          commitTextRuns(result.textRuns, result.selection, "commit");
          return;
        }
        if (!usesShortcutModifier && !event.altKey && event.key.length === 1) {
          event.preventDefault();
          insertText(event.key, "batch");
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    >
      <RichTextContent
        textRuns={textRuns}
        block={block}
        selectionPreview={selectionMode === SELECTION_MODE.TOOLBAR_PREVIEW ? pendingSelectionRef.current : null}
        selectionPreviewMode={selectionMode === SELECTION_MODE.TOOLBAR_PREVIEW ? "inactive" : "none"}
      />
    </div>
  );
}

function buildRichTextFragments(paragraph, paragraphIndex, selectionPreview) {
  const runs = Array.isArray(paragraph?.runs) ? paragraph.runs : [];
  const ordered = orderTextSelection(selectionPreview);
  const previewApplies = ordered && !isCollapsedSelection(ordered) && paragraphIndex >= ordered.start.p && paragraphIndex <= ordered.end.p;
  const fragments = [];
  let cursor = 0;
  runs.forEach((run) => {
    const text = String(run.text || "");
    const nextCursor = cursor + text.length;
    if (!previewApplies) {
      fragments.push({ ...run, text, selected: false });
      cursor = nextCursor;
      return;
    }
    const start = paragraphIndex === ordered.start.p ? ordered.start.offset : 0;
    const end = paragraphIndex === ordered.end.p ? ordered.end.offset : paragraphLength(paragraph);
    if (nextCursor <= start || cursor >= end) {
      fragments.push({ ...run, text, selected: false });
      cursor = nextCursor;
      return;
    }
    const left = Math.max(0, start - cursor);
    const right = Math.min(text.length, end - cursor);
    if (left > 0) fragments.push({ ...run, text: text.slice(0, left), selected: false });
    fragments.push({ ...run, text: text.slice(left, right), selected: true });
    if (right < text.length) fragments.push({ ...run, text: text.slice(right), selected: false });
    cursor = nextCursor;
  });
  return fragments.length ? fragments : [{ ...defaultTextRunStyle({}), text: "", selected: false }];
}

function RichTextContent({ textRuns, block, selectionPreview = null, selectionPreviewMode = "none" }) {
  const model = normalizeTextRuns(textRuns, block);
  const orderedPreview = selectionPreviewMode === "inactive" ? orderTextSelection(selectionPreview) : null;
  return model.paragraphs.map((paragraph, pIndex) => (
    <div className="rich-text-paragraph" data-rich-paragraph={pIndex} style={{ textAlign: paragraph.align }} key={pIndex}>
      {buildRichTextFragments(paragraph, pIndex, orderedPreview).map((run, rIndex) => (
        <span
          data-rich-run={rIndex}
          data-selection-preview={run.selected ? "inactive" : undefined}
          className={`rich-text-fragment ${run.selected ? "is-inactive-selection" : ""}`}
          key={`${pIndex}-${rIndex}`}
          style={{
            fontFamily: run.fontFamily || defaultFontFamily,
            fontSize: `${Math.max(1, Number(run.fontSize) || 15)}px`,
            fontWeight: run.bold ? 700 : 400,
            fontStyle: run.italic ? "italic" : "normal",
            textDecoration: run.underline ? "underline" : "none",
            color: normalizeCssColor(run.color, DEFAULT_TEXT_COLOR),
          }}
        >
          {run.text || "\u200b"}
        </span>
      ))}
    </div>
  ));
}

function domPointToTextPosition(root, node, offset) {
  const paragraphEl = closestElement(node, "[data-rich-paragraph]");
  if (!paragraphEl || !root.contains(paragraphEl)) return { p: 0, offset: 0 };
  const p = Number(paragraphEl.dataset.richParagraph) || 0;
  const runEl = closestElement(node, "[data-rich-run]");
  if (!runEl || !paragraphEl.contains(runEl)) {
    const childIndex = Math.max(0, Math.min(offset, paragraphEl.children.length));
    let total = 0;
    Array.from(paragraphEl.children).slice(0, childIndex).forEach((child) => {
      total += child.textContent.replace(/\u200b/g, "").length;
    });
    return { p, offset: total };
  }
  const runIndex = Number(runEl.dataset.richRun) || 0;
  let total = 0;
  Array.from(paragraphEl.querySelectorAll("[data-rich-run]")).slice(0, runIndex).forEach((child) => {
    total += child.textContent.replace(/\u200b/g, "").length;
  });
  const local = node.nodeType === Node.TEXT_NODE ? offset : Math.min(offset, runEl.textContent.length);
  return { p, offset: total + local };
}

function closestElement(node, selector) {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element?.closest(selector) || null;
}

function restoreDomSelection(root, selection) {
  if (!root || !selection) return;
  const ordered = selection;
  const start = textPositionToDomPoint(root, ordered.start);
  const end = textPositionToDomPoint(root, ordered.end);
  if (!start || !end) return;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const domSelection = window.getSelection();
  domSelection.removeAllRanges();
  domSelection.addRange(range);
}

function textPositionToDomPoint(root, position) {
  const paragraph = root.querySelector(`[data-rich-paragraph="${Math.max(0, Number(position?.p) || 0)}"]`);
  if (!paragraph) return null;
  let remaining = Math.max(0, Number(position?.offset) || 0);
  const runs = Array.from(paragraph.querySelectorAll("[data-rich-run]"));
  for (const run of runs) {
    const textNode = run.firstChild || run;
    const length = run.textContent.replace(/\u200b/g, "").length;
    if (remaining <= length) return { node: textNode, offset: Math.min(remaining, textNode.textContent.length) };
    remaining -= length;
  }
  const last = runs[runs.length - 1];
  if (!last) return { node: paragraph, offset: 0 };
  const textNode = last.firstChild || last;
  return { node: textNode, offset: textNode.textContent.length };
}

function ChartTextLayer({ section, layer, style, className = "", editing = false, onBeginEdit, onEndEdit, onChangeText }) {
  const [draft, setDraft] = useState(layer.text || "");
  const inputRef = useRef(null);
  const rotated = !!layer.rotation;
  const textTransform = rotated ? `rotate(${layer.rotation}deg)` : undefined;
  const rotationStyle = rotated ? { transform: textTransform, transformOrigin: "center center" } : {};
  const justifyContent = layer.align === "left" ? "flex-start" : layer.align === "right" ? "flex-end" : "center";
  useEffect(() => setDraft(layer.text || ""), [layer.text]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  const commit = () => {
    onChangeText?.(section, draft);
    onEndEdit?.();
  };
  const cancel = () => {
    setDraft(layer.text || "");
    onEndEdit?.();
  };
  const stop = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  return (
    <div className={`chart-text-layer ${className} ${rotated ? "is-rotated" : ""} ${editing ? "is-editing" : ""}`} style={{ ...style, justifyContent }} onDoubleClick={(ev) => { stop(ev); onBeginEdit?.(); }}>
      {editing ? (
        <input
          ref={inputRef}
          className="chart-text-editor"
          value={draft}
          onMouseDown={(ev) => ev.stopPropagation()}
          onDoubleClick={(ev) => ev.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") { ev.preventDefault(); commit(); }
            if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
          }}
          style={{ fontSize: layer.fontSize, textAlign: layer.align || "center", ...rotationStyle }}
        />
      ) : (
        <span className="chart-text-content" style={{ textAlign: layer.align || "center", ...rotationStyle }}>{layer.text}</span>
      )}
    </div>
  );
}

function ChartLegendLayer({ layer, traces, items = null, style, onChangeLabel }) {
  const [editingKey, setEditingKey] = useState(null);
  const editable = typeof onChangeLabel === "function";
  const rows = (items || traces.map((trace, i) => ({
    key: trace.name || `series-${i + 1}`,
    name: trace.name || `Series ${i + 1}`,
    color: traceColor(trace, i),
  }))).map((item, i) => ({
    ...item,
    color: item.color || traceColor(traces[i], i),
  }));
  return (
    <div className={`chart-legend-layer ${layer.orientation === "v" ? "vertical" : "horizontal"}`} style={style}>
      {rows.map((item, i) => (
        <span className="legend-item" key={`${item.name}-${i}`}>
          <span className="legend-swatch" style={{ background: item.color }} />
          {editable && editingKey === item.key ? (
            <InlineLabelEditor
              value={item.name}
              className="legend-label-editor"
              onCommit={(value) => {
                onChangeLabel?.(item.key, value);
                setEditingKey(null);
              }}
              onCancel={() => setEditingKey(null)}
            />
          ) : (
            <span
              className={editable ? "editable-legend-label" : ""}
              onMouseDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => {
                if (!editable) return;
                event.preventDefault();
                event.stopPropagation();
                setEditingKey(item.key);
              }}
            >
              {item.name}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function InlineLabelEditor({ value, className = "", onCommit, onCancel }) {
  const [draft, setDraft] = useState(value || "");
  const inputRef = useRef(null);
  useEffect(() => setDraft(value || ""), [value]);
  useEffect(() => inputRef.current?.select(), []);
  const commit = () => onCommit?.(draft);
  return (
    <input
      ref={inputRef}
      className={`inline-label-editor ${className}`}
      value={draft}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel?.();
        }
      }}
    />
  );
}

function XAxisLabelOverlay({ block, experiments, onChangeLabel }) {
  const [editingKey, setEditingKey] = useState(null);
  if (!["selectivity", "conversion", "cbalance"].includes(block.chartKind)) return null;
  const rows = experiments.map((experiment) => ({
    key: experiment.label,
    label: block.opts?.seriesLabels?.[experiment.label] || experiment.label,
  }));
  if (!rows.length) return null;
  return (
    <div className="chart-x-label-overlay" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
      {rows.map((row) => (
        <span className="chart-x-label-cell" key={row.key}>
          {editingKey === row.key ? (
            <InlineLabelEditor
              value={row.label}
              className="x-axis-label-editor"
              onCommit={(value) => {
                onChangeLabel?.(row.key, value);
                setEditingKey(null);
              }}
              onCancel={() => setEditingKey(null)}
            />
          ) : (
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setEditingKey(row.key);
              }}
            >
              {row.label}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

function traceColor(trace, i) {
  const color = trace?.marker?.color || trace?.line?.color || COLORS.line[i % COLORS.line.length];
  return Array.isArray(color) ? color[0] : color;
}

function ChartContextMenu({ x, y, block, onDelete }) {
  if (!block || block.kind !== "chart") return null;
  return (
    <div className="canvas-context-menu chart-context-menu" style={{ left: x, top: y }}>
      <button type="button" onClick={() => onDelete?.(block.id)}>Delete chart</button>
      <div className="context-empty">Chart content is controlled by its approved chart spec.</div>
    </div>
  );
}

function BlockContextMenu({ x, y, block, onDelete }) {
  if (!block || block.kind === "chart") return null;
  const label = block.kind === "text" ? "Delete text box" : "Delete graph";
  return (
    <div className="canvas-context-menu block-context-menu" style={{ left: x, top: y }}>
      <button type="button" onClick={() => onDelete?.(block.id)}>{label}</button>
    </div>
  );
}

function PageContextMenu({ x, y, pageIndex, onAddBefore, onAddAfter, onDelete }) {
  return (
    <div className="canvas-context-menu page-context-menu" style={{ left: x, top: y }}>
      <div className="context-section">
        <div className="context-title">Page {pageIndex + 1}</div>
      </div>
      <button type="button" onClick={onAddBefore}>Add page before</button>
      <button type="button" onClick={onAddAfter}>Add page after</button>
      <button type="button" onClick={onDelete}>Delete page</button>
    </div>
  );
}

function chartLabel(kind) {
  return chartTypes.find(([value]) => value === kind)?.[1] || "Chart";
}

function hasRateTraceData(experiment) {
  const src = experiment?.rate_sources?.[0];
  if (!src) return false;
  const tIdx = src.columns.findIndex((c) => /time/i.test(c));
  const rIdx = src.columns.findIndex((c) => /(reaction )?rate/i.test(c));
  if (tIdx < 0 || rIdx < 0) return false;
  return src.rows.some((row) => row[tIdx] != null && row[rIdx] != null && row[rIdx] >= 1e-10);
}

function chartLegendRows(block, selectedExperiments) {
  if (block.chartKind === "selectivity") {
    return [
      { key: "solid", defaultLabel: "Solid", name: block.opts?.traceLabels?.solid?.trim() || "Solid", color: COLORS.solid },
      { key: "liquid", defaultLabel: "Liquid", name: block.opts?.traceLabels?.liquid?.trim() || "Liquid", color: COLORS.liquid },
      { key: "gas", defaultLabel: "Gas", name: block.opts?.traceLabels?.gas?.trim() || "Gas", color: COLORS.gas },
    ];
  }
  if (block.chartKind === "conversion") return [{ key: "conversion", defaultLabel: "Conversion", name: block.opts?.traceLabels?.conversion?.trim() || "Conversion" }];
  if (block.chartKind === "cbalance") return [{ key: "cbalance", defaultLabel: "Carbon balance", name: block.opts?.traceLabels?.cbalance?.trim() || "Carbon balance" }];
  if (block.chartKind === "rate") {
    return selectedExperiments
      .filter(hasRateTraceData)
      .map((experiment) => {
        const defaultLabel = block.opts?.seriesLabels?.[experiment.label]?.trim() || experiment.label;
        return { key: experiment.label, defaultLabel, name: block.opts?.traceLabels?.[experiment.label]?.trim() || defaultLabel };
      });
  }
  return selectedExperiments.map((experiment) => {
    const defaultLabel = block.opts?.seriesLabels?.[experiment.label]?.trim() || experiment.label;
    return { key: experiment.label, defaultLabel, name: block.opts?.traceLabels?.[experiment.label]?.trim() || defaultLabel };
  });
}

function chartXAxisLabelRows(block, selectedExperiments) {
  if (!["selectivity", "conversion", "cbalance"].includes(block.chartKind)) return [];
  return selectedExperiments.map((experiment) => ({
    key: experiment.label,
    sourceLabel: experiment.label,
    name: block.opts?.seriesLabels?.[experiment.label]?.trim() || experiment.label,
  }));
}

function Inspector({ block, chartSpecs = [], genericImports = [], patch }) {
  if (!block) return null;
  const panel = (title, children, open = false) => (
    <details className="inspector-section" open={open}>
      <summary>{title}</summary>
      <div className="inspector-panel-body">{children}</div>
    </details>
  );
  const patchTextStyle = (patchValue) => patch(block.id, patchValue);
  const chartSpec = block.kind === "chart" ? resolveChartSpecForBlock(block, chartSpecs) : null;
  const chartProposal = chartSpec ? chartSpecToProposal(chartSpec) : null;
  const chartLayout = chartSpec ? resolveChartSpecBlockLayout(block, chartSpec) : null;
  const chartView = normalizeChartView(block.chartView);
  const chartExperimentOptions = chartSpec ? experimentOptionsForChartSpec(chartSpec, genericImports) : [];
  const explicitView = chartView.selectedExperimentIds.length > 0 || chartView.excludedExperimentIds.length > 0;
  const selectedExperimentIds = explicitView ? chartView.selectedExperimentIds : chartExperimentOptions.map((option) => option.id);
  const selectedExperimentSet = new Set(selectedExperimentIds);
  const patchChartViewSelection = (ids) => patch(block.id, {
    chartView: normalizeChartView({
      ...chartView,
      selectedExperimentIds: ids,
      excludedExperimentIds: ids.length ? [] : chartExperimentOptions.map((option) => option.id),
    }),
  });
  const patchChartLayer = (section, patchValue) => {
    if (!chartSpec) return;
    patch(block.id, patchChartSpecBlockLayout(block, chartSpec, section, patchValue), { transactionType: "chart-layout" });
  };
  const resetChartLayout = () => {
    if (!chartSpec) return;
    patch(block.id, { chartLayout: defaultChartSpecBlockLayout(chartSpec, block) }, { transactionType: "chart-layout-reset" });
  };
  const fitPlotArea = () => {
    if (!chartSpec || !chartLayout) return;
    patch(block.id, {
      chartLayout: {
        ...chartLayout,
        plotArea: defaultPlotAreaForLayout(chartSpecLayoutBlock(block, chartSpec), chartLayout),
      },
    }, { transactionType: "chart-layout-fit" });
  };
  const centerTitle = () => {
    if (!chartLayout?.title) return;
    patchChartLayer("title", {
      x: Math.max(0, Math.round(((Number(block.w) || 580) - chartLayout.title.width) / 2)),
      align: "center",
    });
  };
  const numberInput = (section, field, label, min = 0, step = 1) => (
    <label>{label}<input type="number" min={min} step={step} value={Math.round(Number(chartLayout?.[section]?.[field]) || 0)} onChange={(e) => patchChartLayer(section, { [field]: Number(e.target.value) || 0 })} /></label>
  );
  const textLayerControls = (section, label) => {
    const layer = chartLayout?.[section] || {};
    return panel(label, <>
      <label className="inspector-check"><input type="checkbox" checked={layer.visible !== false} onChange={(e) => patchChartLayer(section, { visible: e.target.checked })} /> Visible</label>
      <label>Text<input value={layer.text || ""} onChange={(e) => patchChartLayer(section, { text: e.target.value })} /></label>
      <div className="inspector-grid">
        {numberInput(section, "x", "X")}
        {numberInput(section, "y", "Y")}
        {numberInput(section, "width", "W", 24)}
        {numberInput(section, "height", "H", 18)}
        {numberInput(section, "fontSize", "Font", 1)}
      </div>
      <label>Align<select value={layer.align || "center"} onChange={(e) => patchChartLayer(section, { align: e.target.value })}>
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select></label>
    </>, section === "title");
  };
  return <aside className="inspector"><h3>Inspector</h3>
    {block.kind === "chart" && <>
      {panel("Chart", <>
        <div className="inspector-field">
          <div className="inspector-field-label">Chart spec</div>
          <div className="inspector-selected-list">{chartSpec?.title || chartProposal?.title || block.chartSpecId || "Missing chart spec"}</div>
        </div>
        <div className="inspector-field">
          <div className="inspector-field-label">Type</div>
          <div className="inspector-selected-list">{chartProposal?.chartType || chartSpec?.chartType || "chart"}</div>
        </div>
        <div className="inspector-field">
          <div className="inspector-field-label">Dataset commit</div>
          <div className="inspector-selected-list">{block.datasetCommitId || chartSpec?.datasetCommitId || "n/a"}</div>
        </div>
        <div className="inspector-actions">
          <button type="button" onClick={resetChartLayout} disabled={!chartSpec}>Reset layout</button>
          <button type="button" onClick={fitPlotArea} disabled={!chartSpec}>Fit plot area</button>
          <button type="button" onClick={centerTitle} disabled={!chartSpec}>Center title</button>
        </div>
      </>, true)}
      {panel("Included Experiments", <>
        <div className="inspector-field">
          <div className="inspector-field-label">Included</div>
          <div className="inspector-selected-list">{chartExperimentOptions.length ? `${selectedExperimentIds.length} of ${chartExperimentOptions.length}` : "All source rows"}</div>
        </div>
        {chartExperimentOptions.length > 0 && <>
          <div className="inspector-actions">
            <button type="button" onClick={() => patchChartViewSelection(chartExperimentOptions.map((option) => option.id))}>Select all</button>
            <button type="button" onClick={() => patchChartViewSelection([])}>Clear</button>
          </div>
          <div className="chart-view-choice-list compact">
            {chartExperimentOptions.map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  checked={selectedExperimentSet.has(option.id)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selectedExperimentSet, option.id]
                      : selectedExperimentIds.filter((id) => id !== option.id);
                    patchChartViewSelection(next);
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </>}
      </>, true)}
      {panel("Fields", <>
        <div className="inspector-field">
          <div className="inspector-field-label">X</div>
          <div className="inspector-selected-list">{chartProposal?.x?.label || chartProposal?.x?.field || "n/a"}</div>
        </div>
        <div className="inspector-field">
          <div className="inspector-field-label">Y</div>
          <div className="inspector-selected-list">{chartProposal?.y?.label || chartProposal?.y?.field || chartProposal?.yFields?.map((field) => field.label || field.field).join(", ") || "n/a"}</div>
        </div>
        <div className="inspector-field">
          <div className="inspector-field-label">Source refs</div>
          <div className="inspector-selected-list">{chartProposal?.sourceRefs?.length ? chartProposal.sourceRefs.slice(0, 6).join(", ") : "n/a"}</div>
        </div>
      </>)}
      {chartLayout && textLayerControls("title", "Title")}
      {chartLayout && panel("Legend", <>
        <label className="inspector-check"><input type="checkbox" checked={chartLayout.legend.visible !== false} onChange={(e) => patchChartLayer("legend", { visible: e.target.checked })} /> Visible</label>
        <label>Orientation<select value={chartLayout.legend.orientation || "h"} onChange={(e) => patchChartLayer("legend", { orientation: e.target.value })}>
          <option value="h">Horizontal</option>
          <option value="v">Vertical</option>
        </select></label>
        <div className="inspector-grid">
          {numberInput("legend", "x", "X")}
          {numberInput("legend", "y", "Y")}
          {numberInput("legend", "width", "W", 24)}
          {numberInput("legend", "height", "H", 18)}
          {numberInput("legend", "fontSize", "Font", 1)}
        </div>
      </>)}
      {chartLayout && textLayerControls("xAxisTitle", "X-Axis Title")}
      {chartLayout && textLayerControls("yAxisTitle", "Y-Axis Title")}
      {chartLayout && panel("Plot Area", <>
        <div className="inspector-grid">
          {numberInput("plotArea", "x", "X")}
          {numberInput("plotArea", "y", "Y")}
          {numberInput("plotArea", "width", "W", 24)}
          {numberInput("plotArea", "height", "H", 18)}
        </div>
      </>)}
    </>}
    {block.kind === "text" && <>
      {panel("Text", <>
        <label>Font<select value={block.fontFamily || defaultFontFamily} onChange={(e) => patch(block.id, { fontFamily: e.target.value })}>{fontOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Font size<input type="number" value={block.fontSize || 15} onChange={(e) => patch(block.id, { fontSize: Number(e.target.value) })} /></label>
      </>, true)}
      {panel("Text Box Style", <>
        <label className="inspector-check"><input type="checkbox" checked={!!block.noFill} onChange={(e) => patchTextStyle({ noFill: e.target.checked })} /> No fill</label>
        <label className={block.noFill ? "is-disabled-control" : ""}>Fill color<input type="color" value={normalizeCssColor(block.fillColor, DEFAULT_TEXT_FILL)} disabled={!!block.noFill} onChange={(e) => patchTextStyle({ fillColor: e.target.value, noFill: false })} /></label>
        <label className="inspector-check"><input type="checkbox" checked={!!block.noBorder} onChange={(e) => patchTextStyle({ noBorder: e.target.checked })} /> No border</label>
        <label className={block.noBorder ? "is-disabled-control" : ""}>Border color<input type="color" value={normalizeCssColor(block.borderColor, DEFAULT_TEXT_BORDER)} disabled={!!block.noBorder} onChange={(e) => patchTextStyle({ borderColor: e.target.value, noBorder: false })} /></label>
        <label className={block.noBorder ? "is-disabled-control" : ""}>Border thickness<input type="number" min="0" max="24" step="1" value={Math.max(0, Number(block.borderWidth) || 0)} disabled={!!block.noBorder} onChange={(e) => {
          const borderWidth = Math.max(0, Number(e.target.value) || 0);
          patchTextStyle({ borderWidth, noBorder: borderWidth <= 0 });
        }} /></label>
      </>, true)}
    </>}
  </aside>;
}
