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
  onSort,
  onHide,
  onResize,
  onAutoFit,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  const [menu, setMenu] = useState(null);
  const [dragWidth, setDragWidth] = useState(null);
  const headerRef = useRef(null);

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

  const startResize = (event) => {
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
    column.pinned ? "pinned" : "",
    dragging ? "is-dragging" : "",
    dropEdge === "before" ? "drop-before" : "",
    dropEdge === "after" ? "drop-after" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      ref={headerRef}
      role="columnheader"
      tabIndex={0}
      className={className}
      title={`${column.label}${column.unit ? ` (${column.unit})` : ""}. Click to sort; right-click for column actions.`}
      onClick={() => onSort?.()}
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
      <span
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
      </span>
      {sortDirection ? <small>{sortDirection}</small> : <small className="experiment-sort-idle">sort</small>}
      <span
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
      />
      {menu ? (
        <div
          className="column-header-menu experiment-grid-header-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" disabled={column.pinned} onClick={() => { setMenu(null); onHide?.(); }}>Hide column</button>
          <button type="button" role="menuitem" disabled={!canMoveLeft} onClick={() => { setMenu(null); onMove?.(-1); }}>Move left</button>
          <button type="button" role="menuitem" disabled={!canMoveRight} onClick={() => { setMenu(null); onMove?.(1); }}>Move right</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); onAutoFit?.(); }}>Auto-fit width</button>
        </div>
      ) : null}
    </div>
  );
}
