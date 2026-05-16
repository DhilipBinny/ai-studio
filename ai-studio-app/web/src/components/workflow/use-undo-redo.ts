"use client";

import { useState, useCallback } from "react";
import type { Node, Edge } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Undo/Redo hook for canvas state management
// ---------------------------------------------------------------------------

export interface CanvasState {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

export function useUndoRedo(initialState: CanvasState) {
  const [history, setHistory] = useState<CanvasState[]>([initialState]);
  const [pointer, setPointer] = useState(0);

  const pushState = useCallback((state: CanvasState) => {
    setHistory((prev) => {
      const truncated = prev.slice(0, pointer + 1); // Discard redo states
      const next = [...truncated, state];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setPointer((p) => Math.min(p + 1, MAX_HISTORY - 1));
  }, [pointer]);

  const undo = useCallback((): CanvasState | null => {
    if (pointer <= 0) return null;
    const prevState = history[pointer - 1];
    setPointer((p) => p - 1);
    return prevState ?? null;
  }, [pointer, history]);

  const redo = useCallback((): CanvasState | null => {
    if (pointer >= history.length - 1) return null;
    const nextState = history[pointer + 1];
    setPointer((p) => p + 1);
    return nextState ?? null;
  }, [pointer, history]);

  const resetHistory = useCallback((state: CanvasState) => {
    setHistory([state]);
    setPointer(0);
  }, []);

  const canUndo = pointer > 0;
  const canRedo = pointer < history.length - 1;

  return { pushState, undo, redo, canUndo, canRedo, resetHistory };
}
