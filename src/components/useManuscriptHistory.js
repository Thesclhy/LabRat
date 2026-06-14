import { useEffect, useReducer, useRef } from "react";
import { createManuscriptHistoryManager } from "../utils/manuscriptHistory";

export function useManuscriptHistory({ captureSnapshot, applySnapshot, limit = 80 }) {
  const [, bumpVersion] = useReducer((value) => value + 1, 0);
  const historyRef = useRef(null);

  if (!historyRef.current) {
    historyRef.current = createManuscriptHistoryManager({
      captureSnapshot,
      applySnapshot,
      limit,
      onStateChange: () => bumpVersion(),
    });
  }

  useEffect(() => {
    historyRef.current.setBindings({
      captureSnapshot,
      applySnapshot,
      onStateChange: () => bumpVersion(),
    });
  }, [captureSnapshot, applySnapshot]);

  const history = historyRef.current;
  const state = history.getState();

  return {
    history,
    ...state,
  };
}
