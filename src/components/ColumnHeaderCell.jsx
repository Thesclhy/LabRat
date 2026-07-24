import React, { useEffect, useRef, useState } from "react";

const MIN_COLUMN_WIDTH = 56;

// A column header that supports a right-click menu (Hide / Rename / Move / Auto-fit),
// inline renaming, drag-to-resize on its right edge, and drag-to-reorder by its body.
export function ColumnHeaderCell({
  label,
  unit,
  title,
  width,
  isDragging = false,
  dropEdge = null,
  sortDir = null,
  onSort,
  onHide,
  onRename,
  onResize,
  onAutoFit,
  onReorderStart,
  onReorderOver,
  onReorderDrop,
  onReorderEnd,
  onMove,
  canMoveLeft = false,
  canMoveRight = false,
}) {
  const [menu, setMenu] = useState(null); // { x, y } in viewport coords
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label || "");
  const [dragWidth, setDragWidth] = useState(null);
  const thRef = useRef(null);

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

  const openMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const startRename = () => {
    setDraft(label || "");
    setRenaming(true);
    setMenu(null);
  };

  const commitRename = () => {
    setRenaming(false);
    if (draft !== label) onRename?.(draft);
  };

  const cancelRename = () => {
    setRenaming(false);
    setDraft(label || "");
  };

  const startResize = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = thRef.current?.offsetWidth || width || MIN_COLUMN_WIDTH;
    let latest = startWidth;
    setDragWidth(startWidth);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMoveEvent = (moveEvent) => {
      latest = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + (moveEvent.clientX - startX)));
      setDragWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMoveEvent);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragWidth(null);
      onResize?.(latest);
    };
    window.addEventListener("mousemove", onMoveEvent);
    window.addEventListener("mouseup", onUp);
  };

  const handleDragOver = (event) => {
    if (!onReorderOver) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = thRef.current?.getBoundingClientRect();
    const before = rect ? event.clientX < rect.left + rect.width / 2 : true;
    onReorderOver(before);
  };

  const effectiveWidth = dragWidth ?? width;
  const style = effectiveWidth ? { width: effectiveWidth, minWidth: effectiveWidth, maxWidth: effectiveWidth } : undefined;

  if (renaming) {
    return (
      <th ref={thRef} className="column-header column-header-renaming" style={style}>
        <input
          autoFocus
          className="column-rename-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelRename();
            }
          }}
        />
      </th>
    );
  }

  const className = [
    "column-header",
    isDragging ? "is-dragging" : "",
    dropEdge === "before" ? "drop-before" : "",
    dropEdge === "after" ? "drop-after" : "",
  ].filter(Boolean).join(" ");

  return (
    <th
      ref={thRef}
      className={className}
      title={title || label}
      style={style}
      onClick={onSort ? () => onSort() : undefined}
      onContextMenu={openMenu}
      onDragOver={handleDragOver}
      onDrop={(event) => { if (onReorderDrop) { event.preventDefault(); onReorderDrop(); } }}
    >
      <span
        className="column-header-label"
        draggable={!!onReorderStart}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", label || "");
          onReorderStart?.();
        }}
        onDragEnd={() => onReorderEnd?.()}
      >
        <span className="column-drag-grip" aria-hidden="true">{"⠿"}</span>
        {label}
      </span>
      {unit && <small> {unit}</small>}
      {onSort && (
        <span className={`column-sort-arrow ${sortDir || ""}`} aria-hidden="true">
          {sortDir === "asc" ? "▲" : sortDir === "desc" ? "▼" : "↕"}
        </span>
      )}
      <span
        className="column-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize column"
        title="Drag to resize, double-click to auto-fit"
        onMouseDown={startResize}
        onDoubleClick={(event) => { event.stopPropagation(); onAutoFit?.(); }}
        onClick={(event) => event.stopPropagation()}
      />
      {menu && (
        <div className="column-header-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); onHide?.(); }}>Hide column</button>
          <button type="button" role="menuitem" onClick={startRename}>Rename...</button>
          <button type="button" role="menuitem" disabled={!canMoveLeft} onClick={() => { setMenu(null); onMove?.("left"); }}>Move left</button>
          <button type="button" role="menuitem" disabled={!canMoveRight} onClick={() => { setMenu(null); onMove?.("right"); }}>Move right</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); onAutoFit?.(); }}>Auto-fit width</button>
        </div>
      )}
    </th>
  );
}
