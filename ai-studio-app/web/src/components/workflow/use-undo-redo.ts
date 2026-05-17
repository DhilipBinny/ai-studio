"use client";

import { useCallback, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Undo/Redo hook for canvas state management
// Uses refs to avoid stale closure issues with rapid operations
// ---------------------------------------------------------------------------

export interface CanvasState {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

export function useUndoRedo(initialState: CanvasState) {
  const historyRef = useRef<CanvasState[]>([initialState]);
  const pointerRef = useRef(0);
  const [, forceUpdate] = useState(0);

  const pushState = useCallback((state: CanvasState) => {
    const truncated = historyRef.current.slice(0, pointerRef.current + 1);
    truncated.push(state);
    if (truncated.length > MAX_HISTORY) truncated.shift();
    historyRef.current = truncated;
    pointerRef.current = truncated.length - 1;
    forceUpdate((n) => n + 1);
  }, []);

  const undo = useCallback((): CanvasState | null => {
    if (pointerRef.current <= 0) return null;
    pointerRef.current -= 1;
    forceUpdate((n) => n + 1);
    return historyRef.current[pointerRef.current] ?? null;
  }, []);

  const redo = useCallback((): CanvasState | null => {
    if (pointerRef.current >= historyRef.current.length - 1) return null;
    pointerRef.current += 1;
    forceUpdate((n) => n + 1);
    return historyRef.current[pointerRef.current] ?? null;
  }, []);

  const resetHistory = useCallback((state: CanvasState) => {
    historyRef.current = [state];
    pointerRef.current = 0;
    forceUpdate((n) => n + 1);
  }, []);

  const canUndo = pointerRef.current > 0;
  const canRedo = pointerRef.current < historyRef.current.length - 1;

  return { pushState, undo, redo, canUndo, canRedo, resetHistory };
}
