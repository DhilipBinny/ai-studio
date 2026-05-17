"use client";

import { CompactStatus } from "@/components/activity/event-feed";

interface ChatAssistantActivityProps {
  sessionId: string | null;
  sending: boolean;
}

export function ChatAssistantActivity({ sessionId, sending }: ChatAssistantActivityProps) {
  if (!sending || !sessionId) return null;

  return (
    <div className="border-t px-3 py-1.5">
      <CompactStatus traceId={sessionId} enabled={sending} />
    </div>
  );
}
