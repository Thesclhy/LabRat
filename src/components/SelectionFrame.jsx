import React, { useRef } from "react";
import { beginDocumentDrag, clampFrame, resizeFrame } from "../utils/geometry";

const selectionHandles = [
  ["nw", "nwse-resize"],
  ["n", "ns-resize"],
  ["ne", "nesw-resize"],
  ["e", "ew-resize"],
  ["se", "nwse-resize"],
  ["s", "ns-resize"],
  ["sw", "nesw-resize"],
  ["w", "ew-resize"],
];

export function SelectionFrame({
  selected,
  x,
  y,
  width,
  height,
  minWidth = 24,
  minHeight = 18,
  bounds,
  className = "",
  style,
  activation = "single",
  disableKeyboardDelete = false,
  onSelect,
  onChange,
  onDelete,
  onContextMenu,
  onMoveStart,
  onMoveEnd,
  onResizeStart,
  onResizeEnd,
  onUndo,
  onRedo,
  children,
}) {
  const ref = useRef(null);
  const beginDrag = (ev) => {
    if (ev.button !== 0 || ev.target.closest("button, input, textarea, select, .selection-handle")) return;
    if (activation === "double" && !selected) return;
    ev.preventDefault();
    ev.stopPropagation();
    onSelect?.();
    ref.current?.focus();
    const sx = ev.clientX, sy = ev.clientY;
    const start = { x, y, width, height };
    onMoveStart?.();
    beginDocumentDrag("move", "move", (e) => {
      onChange(clampFrame({ ...start, x: start.x + e.clientX - sx, y: start.y + e.clientY - sy }, minWidth, minHeight, bounds), { history: "defer", transactionType: "block-move" });
    }, () => onMoveEnd?.());
  };
  const beginResize = (dir, cursor, ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onSelect?.();
    ref.current?.focus();
    const sx = ev.clientX, sy = ev.clientY;
    const start = { x, y, width, height };
    onResizeStart?.();
    beginDocumentDrag(dir, cursor, (e) => {
      onChange(resizeFrame(start, dir, e.clientX - sx, e.clientY - sy, minWidth, minHeight, bounds), { history: "defer", transactionType: "block-resize" });
    }, () => onResizeEnd?.());
  };
  const onKeyDown = (ev) => {
    if (!selected) return;
    const editingTarget = ev.target.closest("input, textarea, select, [contenteditable='true']");
    if (editingTarget) return;
    const usesShortcutModifier = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    if (usesShortcutModifier && key === "z") {
      ev.preventDefault();
      if (ev.shiftKey) onRedo?.();
      else onUndo?.();
      return;
    }
    if (usesShortcutModifier && key === "y") {
      ev.preventDefault();
      onRedo?.();
      return;
    }
    const step = ev.shiftKey ? 10 : 1;
    const moves = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[ev.key]) {
      ev.preventDefault();
      const [dx, dy] = moves[ev.key];
      onChange(clampFrame({ x: x + dx, y: y + dy, width, height }, minWidth, minHeight, bounds), { history: "immediate", transactionType: "block-move" });
    } else if ((ev.key === "Delete" || ev.key === "Backspace") && onDelete && !disableKeyboardDelete) {
      ev.preventDefault();
      onDelete();
    }
  };
  return (
    <div
      ref={ref}
      tabIndex={0}
      className={`selection-frame ${selected ? "is-selected" : ""} ${className}`}
      style={{ ...style, left: x, top: y, width, height }}
      onMouseDown={beginDrag}
      onDoubleClickCapture={(ev) => {
        if (activation !== "double" || selected) return;
        ev.preventDefault();
        ev.stopPropagation();
        onSelect?.();
        ref.current?.focus();
      }}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      {children}
      {selected && selectionHandles.map(([dir, cursor]) => (
        <span key={dir} className={`selection-handle ${dir}`} onMouseDown={(ev) => beginResize(dir, cursor, ev)} />
      ))}
    </div>
  );
}
