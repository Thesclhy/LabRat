export function beginDocumentDrag(label, cursor, onMove, onEnd) {
  const previousCursor = document.body.style.cursor;
  const previousSelect = document.body.style.userSelect;
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  const move = (e) => {
    e.preventDefault();
    onMove(e);
  };
  const up = () => {
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousSelect;
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    onEnd?.();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

export function resizeFrame(start, dir, dx, dy, minWidth, minHeight, bounds) {
  let next = { ...start };
  if (dir.includes("e")) next.width = start.width + dx;
  if (dir.includes("s")) next.height = start.height + dy;
  if (dir.includes("w")) {
    next.x = start.x + dx;
    next.width = start.width - dx;
  }
  if (dir.includes("n")) {
    next.y = start.y + dy;
    next.height = start.height - dy;
  }
  if (next.width < minWidth) {
    if (dir.includes("w")) next.x -= minWidth - next.width;
    next.width = minWidth;
  }
  if (next.height < minHeight) {
    if (dir.includes("n")) next.y -= minHeight - next.height;
    next.height = minHeight;
  }
  return clampFrame(next, minWidth, minHeight, bounds);
}

export function clampFrame(frame, minWidth, minHeight, bounds) {
  const next = {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.max(minWidth, Math.round(frame.width)),
    height: Math.max(minHeight, Math.round(frame.height)),
  };
  if (bounds) {
    next.width = Math.min(next.width, bounds.width);
    next.height = Math.min(next.height, bounds.height);
    next.x = Math.min(Math.max(0, next.x), Math.max(0, bounds.width - next.width));
    next.y = Math.min(Math.max(0, next.y), Math.max(0, bounds.height - next.height));
  } else {
    next.x = Math.max(0, next.x);
    next.y = Math.max(0, next.y);
  }
  return next;
}
