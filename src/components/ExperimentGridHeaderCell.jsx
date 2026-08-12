import React, { useEffect, useRef, useState } from "react";

const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 800;

function boundedWidth(value) {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(Number(value) || MIN_COLUMN_WIDTH)));
}

export function ExperimentGridHeaderCell({
  column,
  width,
  sortDirection = null,
  draggable = false,
  dragging = false,
  dropEdge = null,
  canMoveLeft = false,
  canMoveRight = false,
  editable = false,
  onSort,
  onHide,
  onRename,
  onResize,
  onAutoFit,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onDelete,
}) {
  const [menu, setMenu] = useState(null);
  const [dragWidth, setDragWidth] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const headerRef = useRef(null);
  const sortTimerRef = useRef(null);
  const renameCancelledRef = useRef(false);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  useEffect(() => () => window.clearTimeout(sortTimerRef.current), []);

  const startResize = (event) => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = headerRef.current?.getBoundingClientRect().width || width || MIN_COLUMN_WIDTH;
    let latestWidth = startWidth;
    setDragWidth(startWidth);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (moveEvent) => {
      latestWidth = boundedWidth(startWidth + moveEvent.clientX - startX);
      setDragWidth(latestWidth);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragWidth(null);
      onResize?.(latestWidth);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const className = [
    "experiment-grid-header-cell",
    dragging ? "is-dragging" : "",
    dropEdge === "before" ? "drop-before" : "",
    dropEdge === "after" ? "drop-after" : "",
  ].filter(Boolean).join(" ");

  const beginRename = () => {
    if (!editable) return;
    setMenu(null);
    renameCancelledRef.current = false;
    setDraftLabel(column.label || "");
    setRenaming(true);
  };

  const commitRename = () => {
    if (!renaming) return;
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      setRenaming(false);
      return;
    }
    const nextLabel = draftLabel.trim();
    const originalLabel = String(column.originalLabel || column.label || "").trim();
    onRename?.(nextLabel && nextLabel !== originalLabel ? nextLabel : undefined);
    setRenaming(false);
  };

  return (
    <div
      ref={headerRef}
      role="columnheader"
      tabIndex={0}
      className={className}
      title={`${column.label}${column.unit ? ` (${column.unit})` : ""}. Click to sort; right-click for column actions.`}
      onClick={() => {
        if (!column.isCustom) { onSort?.(); return; }
        window.clearTimeout(sortTimerRef.current);
        sortTimerRef.current = window.setTimeout(() => onSort?.(), 220);
      }}
      onDoubleClick={(event) => {
        if (!column.isCustom || !editable) return;
        event.preventDefault();
        event.stopPropagation();
        window.clearTimeout(sortTimerRef.current);
        beginRename();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSort?.();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenu({
          x: Math.min(event.clientX, window.innerWidth - 170),
          y: Math.min(event.clientY, window.innerHeight - 150),
        });
      }}
      onDragOver={(event) => {
        if (!onDragOver) return;
        event.preventDefault();
        const rect = headerRef.current?.getBoundingClientRect();
        onDragOver(rect ? event.clientX < rect.left + rect.width / 2 : true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop?.();
      }}
    >
      {renaming ? (
        <input
          className="experiment-grid-header-rename"
          aria-label={`Rename ${column.label}`}
          value={draftLabel}
          autoFocus
          maxLength={120}
          onChange={(event) => setDraftLabel(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") {
              event.preventDefault();
              renameCancelledRef.current = true;
              setDraftLabel(column.label || "");
              setRenaming(false);
            }
          }}
        />
      ) : <span
        className="experiment-grid-header-label"
        draggable={draggable}
        onDragStart={(event) => {
          if (!draggable) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", column.id);
          onDragStart?.();
        }}
        onDragEnd={() => onDragEnd?.()}
      >
        {draggable ? <span className="experiment-column-drag-grip" aria-hidden="true">::</span> : null}
        <span>{column.label}</span>
      </span>}
      {sortDirection ? <small className="experiment-sort-direction">{sortDirection}</small> : null}
      {editable ? <span
        className="experiment-column-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${column.label}`}
        title="Drag to resize; double-click to auto-fit"
        style={dragWidth ? { transform: `translateX(${dragWidth - width}px)` } : undefined}
        onMouseDown={startResize}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onAutoFit?.();
        }}
        onClick={(event) => event.stopPropagation()}
      /> : null}
      {menu ? (
        <div
          className="column-header-menu experiment-grid-header-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" disabled={!editable} onClick={() => { setMenu(null); onHide?.(); }}>Hide column</button>
          <button type="button" role="menuitem" disabled={!editable} onClick={beginRename}>Rename column</button>
          <button type="button" role="menuitem" disabled={!canMoveLeft} onClick={() => { setMenu(null); onMove?.(-1); }}>Move left</button>
          <button type="button" role="menuitem" disabled={!canMoveRight} onClick={() => { setMenu(null); onMove?.(1); }}>Move right</button>
          <button type="button" role="menuitem" disabled={!editable} onClick={() => { setMenu(null); onAutoFit?.(); }}>Auto-fit width</button>
          {column.isCustom ? <button type="button" role="menuitem" className="danger-action" disabled={!editable} onClick={() => { setMenu(null); onDelete?.(); }}>Delete column</button> : null}
        </div>
      ) : null}
    </div>
  );
}
