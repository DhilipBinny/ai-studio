"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <div className={className} data-value={value}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<{ value?: string; activeValue?: string; onValueChange?: (v: string) => void }>, { activeValue: value, onValueChange });
        }
        return child;
      })}
    </div>
  );
}

function TabsList({ className, children, activeValue, onValueChange, ...props }: React.HTMLAttributes<HTMLDivElement> & { activeValue?: string; onValueChange?: (v: string) => void }) {
  return (
    <div className={cn("inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<{ activeValue?: string; onValueChange?: (v: string) => void }>, { activeValue, onValueChange });
        }
        return child;
      })}
    </div>
  );
}

function TabsTrigger({ className, value, children, activeValue, onValueChange, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string; activeValue?: string; onValueChange?: (v: string) => void }) {
  const isActive = value === activeValue;
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all",
        isActive ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
        className
      )}
      onClick={() => onValueChange?.(value)}
      {...props}
    >
      {children}
    </button>
  );
}

function TabsContent({ className, value, children, activeValue, ...props }: React.HTMLAttributes<HTMLDivElement> & { value: string; activeValue?: string }) {
  if (value !== activeValue) return null;
  return <div className={cn("mt-4", className)} {...props}>{children}</div>;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
