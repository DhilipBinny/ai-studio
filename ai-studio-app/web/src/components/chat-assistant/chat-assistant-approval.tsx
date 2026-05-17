"use client";

import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PendingToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

interface ChatAssistantApprovalProps {
  pendingCalls: PendingToolCall[];
  onDecision: (toolCallId: string, action: "approve" | "deny") => void;
  disabled: boolean;
}

export function ChatAssistantApproval({ pendingCalls, onDecision, disabled }: ChatAssistantApprovalProps) {
  if (pendingCalls.length === 0) return null;

  return (
    <div className="mx-3 my-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/30 dark:border-amber-700">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
        <AlertCircle className="h-4 w-4" />
        Tool approval required
      </div>
      {pendingCalls.map((tc) => (
        <div key={tc.id} className="mt-2 rounded-md border bg-background p-2">
          <div className="flex items-center justify-between gap-2">
            <code className="text-xs font-mono truncate">{tc.toolName}</code>
            <div className="flex gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                disabled={disabled}
                onClick={() => onDecision(tc.id, "deny")}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Deny
              </Button>
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={disabled}
                onClick={() => onDecision(tc.id, "approve")}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Approve
              </Button>
            </div>
          </div>
          {tc.arguments && Object.keys(tc.arguments).length > 0 && (
            <pre className="mt-1.5 max-h-16 overflow-auto rounded bg-muted p-1.5 text-[10px] text-muted-foreground">
              {JSON.stringify(tc.arguments, null, 2).slice(0, 300)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
