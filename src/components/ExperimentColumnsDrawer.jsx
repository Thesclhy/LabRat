import React, { useEffect, useMemo, useRef } from "react";

const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 800;

function orderedSettings(settings) {
  return [...settings].sort((left, right) => left.order - right.order);
}

function normalizeOrder(settings) {
  return settings.map((setting, index) => ({ ...setting, order: index }));
}

export function ExperimentColumnsDrawer({
  open,
  columns = [],
  settings = [],
  onChange,
  readOnly = false,
  onClose,
  returnFocusRef,
}) {
  const closeButtonRef = useRef(null);
  const columnsById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );
  const ordered = useMemo(() => orderedSettings(settings), [settings]);

  useEffect(() => {
    if (!open) return undefined;
    closeButtonRef.current?.focus();
    return () => returnFocusRef?.current?.focus();
  }, [open, returnFocusRef]);

  if (!open) return null;

  const updateSetting = (columnId, patch) => {
    onChange?.(settings.map((setting) => (
      setting.columnId === columnId ? { ...setting, ...patch } : setting
    )));
  };

  const move = (columnId, direction) => {
    const next = orderedSettings(settings);
    const currentIndex = next.findIndex((setting) => setting.columnId === columnId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= next.length) return;
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
    onChange?.(normalizeOrder(next));
  };

  return (
    <div className="experiment-columns-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <aside
        className="experiment-columns-drawer"
        aria-label="Configure experiment columns"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose?.();
          }
        }}
      >
        <header className="experiment-columns-drawer__header">
          <div>
            <h3>Columns</h3>
            <p>Choose the fields shown in the shared project Browser.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            aria-label="Close column settings"
            title="Close"
            onClick={onClose}
          >
            &times;
          </button>
        </header>

        <div className="experiment-columns-drawer__list">
          {ordered.map((setting, index) => {
            const column = columnsById.get(setting.columnId);
            if (!column) return null;
            return (
              <div className="experiment-column-setting" key={column.id}>
                <label className="experiment-column-setting__visibility">
                  <input
                    type="checkbox"
                    checked={!setting.hidden}
                    disabled={readOnly}
                    aria-label={`Show ${column.label}`}
                    onChange={(event) => updateSetting(column.id, { hidden: !event.target.checked })}
                  />
                  <span>
                    <strong>{column.label}</strong>
                  </span>
                </label>
                <div className="experiment-column-setting__controls">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move ${column.label} up`}
                    title="Move up"
                    disabled={readOnly || index === 0}
                    onClick={() => move(column.id, -1)}
                  >
                    &#8593;
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move ${column.label} down`}
                    title="Move down"
                    disabled={readOnly || index === ordered.length - 1}
                    onClick={() => move(column.id, 1)}
                  >
                    &#8595;
                  </button>
                  <label className="experiment-column-setting__width">
                    <span>Width</span>
                    <input
                      type="number"
                      min={MIN_COLUMN_WIDTH}
                      max={MAX_COLUMN_WIDTH}
                      value={setting.width}
                      disabled={readOnly}
                      aria-label={`Width for ${column.label}`}
                      onChange={(event) => {
                        const width = Math.min(
                          MAX_COLUMN_WIDTH,
                          Math.max(MIN_COLUMN_WIDTH, Number(event.target.value) || MIN_COLUMN_WIDTH),
                        );
                        updateSetting(column.id, { width });
                      }}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <footer className="experiment-columns-drawer__footer">
          <button type="button" className="primary-action" onClick={onClose}>
            Done
          </button>
        </footer>
      </aside>
    </div>
  );
}
