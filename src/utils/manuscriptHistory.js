function cloneSnapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createManuscriptHistoryManager({ captureSnapshot, applySnapshot, limit = 80, onStateChange } = {}) {
  let capture = captureSnapshot;
  let apply = applySnapshot;
  let notify = onStateChange;
  let undoStack = [];
  let redoStack = [];
  let activeTransaction = null;

  const emitChange = () => {
    notify?.(manager.getState());
  };

  const captureClone = () => cloneSnapshot(capture?.() || {});

  const clearRedo = () => {
    redoStack = [];
  };

  const manager = {
    setBindings(next = {}) {
      if (typeof next.captureSnapshot === "function") capture = next.captureSnapshot;
      if (typeof next.applySnapshot === "function") apply = next.applySnapshot;
      if (typeof next.onStateChange === "function") notify = next.onStateChange;
    },
    getState() {
      return {
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        undoDepth: undoStack.length,
        redoDepth: redoStack.length,
        activeTransaction: activeTransaction ? { type: activeTransaction.type, meta: activeTransaction.meta || null } : null,
      };
    },
    getActiveTransaction() {
      return activeTransaction ? { ...activeTransaction } : null;
    },
    captureSnapshot() {
      return captureClone();
    },
    applySnapshot(snapshot) {
      apply?.(cloneSnapshot(snapshot));
      emitChange();
    },
    beginTransaction(type, meta = null) {
      if (activeTransaction) manager.commitTransaction();
      activeTransaction = {
        type,
        meta,
        startSnapshot: captureClone(),
        dirty: false,
      };
      emitChange();
      return activeTransaction;
    },
    markDirty() {
      if (!activeTransaction) return false;
      activeTransaction.dirty = true;
      emitChange();
      return true;
    },
    commitTransaction() {
      if (!activeTransaction) return false;
      const committed = activeTransaction.dirty;
      if (committed) {
        undoStack = [...undoStack.slice(-(limit - 1)), cloneSnapshot(activeTransaction.startSnapshot)];
        clearRedo();
      }
      activeTransaction = null;
      emitChange();
      return committed;
    },
    cancelTransaction() {
      if (!activeTransaction) return false;
      activeTransaction = null;
      emitChange();
      return true;
    },
    flushActiveTransaction() {
      return manager.commitTransaction();
    },
    runImmediateTransaction(type, fn, meta = null) {
      manager.flushActiveTransaction();
      manager.beginTransaction(type, meta);
      const result = fn?.();
      if (result !== false) manager.markDirty();
      manager.commitTransaction();
      return result;
    },
    undo() {
      manager.flushActiveTransaction();
      const snapshot = undoStack.pop();
      if (!snapshot) {
        emitChange();
        return false;
      }
      redoStack = [...redoStack, captureClone()];
      apply?.(cloneSnapshot(snapshot));
      emitChange();
      return true;
    },
    redo() {
      manager.flushActiveTransaction();
      const snapshot = redoStack.pop();
      if (!snapshot) {
        emitChange();
        return false;
      }
      undoStack = [...undoStack, captureClone()];
      apply?.(cloneSnapshot(snapshot));
      emitChange();
      return true;
    },
  };

  return manager;
}
