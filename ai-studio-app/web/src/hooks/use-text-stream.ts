"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export function useTextStream(traceId: string | null, enabled: boolean) {
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const textRef = useRef("");

  const reset = useCallback(() => {
    textRef.current = "";
    setStreamingText("");
    setIsStreaming(false);
  }, []);

  useEffect(() => {
    if (!traceId || !enabled) return;

    let cancelled = false;
    textRef.current = "";
    setStreamingText("");

    const source = new EventSource(`/api/progress?traceId=${traceId}`);

    source.addEventListener("text_delta", (e) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(e.data);
        if (data.delta) {
          if (data.delta.includes("__RESET__")) {
            textRef.current = "";
            setStreamingText("");
          } else {
            textRef.current += data.delta;
            if (textRef.current.length > 100_000) textRef.current = textRef.current.slice(-50_000);
            setStreamingText(textRef.current);
          }
          setIsStreaming(true);
        }
      } catch { /* parse error */ }
    });

    source.addEventListener("span", (e) => {
      if (cancelled) return;
      try {
        const span = JSON.parse(e.data);
        if (span.spanKind === "llm" && span.phase === "start") {
          textRef.current = "";
          setStreamingText("");
          setIsStreaming(true);
        }
        if (span.spanKind === "llm" && span.phase === "complete") {
          setIsStreaming(false);
        }
      } catch { /* parse error */ }
    });

    source.onerror = () => {
      if (!cancelled) setIsStreaming(false);
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [traceId, enabled]);

  return { streamingText, isStreaming, reset };
}
