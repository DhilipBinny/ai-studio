"use client";

import { MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatAssistantFabProps {
  open: boolean;
  sending: boolean;
  onClick: () => void;
}

export function ChatAssistantFab({ open, sending, onClick }: ChatAssistantFabProps) {
  return (
    <button
      onClick={onClick}
      aria-label={open ? "Close chat assistant" : "Open chat assistant"}
      className={cn(
        "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center",
        "rounded-full shadow-lg transition-all duration-200",
        "bg-primary text-primary-foreground hover:bg-primary/90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        open && "rotate-90 scale-90"
      )}
    >
      {open ? <X className="h-6 w-6" /> : <MessageSquare className="h-6 w-6" />}
      {sending && !open && (
        <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-green-500" />
        </span>
      )}
    </button>
  );
}
