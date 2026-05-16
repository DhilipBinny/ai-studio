"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

type DialogSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "full";

const sizeClasses: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  full: "max-w-[90vw]",
};

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  size?: DialogSize;
}

const DialogSizeContext = React.createContext<DialogSize>("lg");

function Dialog({ open, onOpenChange, children, size = "lg" }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogSizeContext.Provider value={size}>
        {open ? children : null}
      </DialogSizeContext.Provider>
    </DialogPrimitive.Root>
  );
}

const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }
>(({ className, children, onClose, ...props }, ref) => {
  const size = React.useContext(DialogSizeContext);

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 duration-200" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 p-4",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "data-[state=open]:zoom-in-[0.97] data-[state=closed]:zoom-out-[0.97]",
          "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
          "duration-200",
          sizeClasses[size]
        )}
        onOpenAutoFocus={(e) => {
          const firstInput = (e.target as HTMLElement)?.querySelector<HTMLElement>(
            "input:not([type=hidden]), textarea, select"
          );
          if (firstInput) {
            e.preventDefault();
            firstInput.focus();
          }
        }}
        {...props}
      >
        <div
          className={cn(
            "relative max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-[0_16px_70px_-12px_rgba(0,0,0,0.22)]",
            className
          )}
        >
          {onClose && (
            <DialogPrimitive.Close
              onClick={onClose}
              className="absolute right-4 top-4 z-10 rounded-md p-1.5 text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          )}
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = "DialogContent";

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 pb-4 pr-8 border-b border-border", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <DialogPrimitive.Title asChild>
      <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
    </DialogPrimitive.Title>
  );
}

function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <DialogPrimitive.Description asChild>
      <p className={cn("text-sm text-muted-foreground", className)} {...props} />
    </DialogPrimitive.Description>
  );
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse gap-2 pt-4 border-t border-border sm:flex-row sm:justify-end", className)} {...props} />;
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
export type { DialogSize };
