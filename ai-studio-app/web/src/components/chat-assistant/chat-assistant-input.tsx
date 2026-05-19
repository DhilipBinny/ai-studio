"use client";

import { useState, useRef, useCallback } from "react";
import { Send, Paperclip, X, FileText, Image as ImageIcon, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChatAttachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  storagePath: string;
  category: "text" | "image" | "pdf";
  textContent: string | null;
}

interface ChatAssistantInputProps {
  sending: boolean;
  onSend: (message: string, attachments?: ChatAttachment[]) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function AttachmentIcon({ category }: { category: string }) {
  switch (category) {
    case "image": return <ImageIcon className="h-3 w-3 shrink-0" />;
    case "text": return <FileText className="h-3 w-3 shrink-0" />;
    default: return <File className="h-3 w-3 shrink-0" />;
  }
}

export function ChatAssistantInput({ sending, onSend }: ChatAssistantInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetHeight = useCallback(() => {
    if (textareaRef.current) textareaRef.current.style.height = "40px";
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || sending || uploading) return;
    onSend(trimmed || "(attached file)", attachments.length > 0 ? attachments : undefined);
    setText("");
    setAttachments([]);
    resetHeight();
  }, [text, attachments, sending, uploading, onSend, resetHeight]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "40px";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/chat/upload", { method: "POST", body: formData });
        if (res.ok) {
          const data: ChatAttachment = await res.json();
          setAttachments((prev) => [...prev, data]);
        }
      }
    } catch { /* upload error */ } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return (
    <div className="border-t">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
              <AttachmentIcon category={a.category} />
              <span className="max-w-[120px] truncate">{a.fileName}</span>
              <span className="text-muted-foreground">{formatSize(a.fileSizeBytes)}</span>
              <button onClick={() => removeAttachment(a.id)} className="ml-0.5 hover:text-destructive" aria-label={`Remove ${a.fileName}`}>
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 p-3">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".txt,.md,.csv,.json,.xml,.yaml,.yml,.log,.py,.js,.ts,.sql,.png,.jpg,.jpeg,.gif,.webp,.pdf"
          multiple
          onChange={handleFileSelect}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || uploading}
          aria-label="Attach file"
        >
          <Paperclip className={cn("h-4 w-4", uploading && "animate-pulse")} />
        </Button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          aria-label="Chat message"
          disabled={sending}
          rows={1}
          className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          style={{ height: "40px", maxHeight: "120px" }}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={(!text.trim() && attachments.length === 0) || sending || uploading}
          aria-label="Send message"
          className="h-10 w-10 shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
