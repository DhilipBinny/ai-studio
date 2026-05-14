"use client";

import { NODE_REGISTRY, CATEGORY_LABELS } from "./canvas-types";

// ---------------------------------------------------------------------------
// Node Palette (left sidebar)
// ---------------------------------------------------------------------------

export function NodePalette({ onAdd }: { onAdd: (type: string) => void }) {
  const categories = Object.entries(CATEGORY_LABELS);

  return (
    <div className="w-56 shrink-0 border-r border-border bg-muted/10 overflow-y-auto">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add Node</p>
      </div>
      {categories.map(([cat, label]) => {
        const items = NODE_REGISTRY.filter((n) => n.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5">{label}</p>
            <div className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    onClick={() => onAdd(item.type)}
                    className="flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 hover:bg-muted/60 transition-colors cursor-pointer text-left group"
                  >
                    <div
                      className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-transform group-hover:scale-105"
                      style={{ backgroundColor: `${item.color}15` }}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color: item.color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium leading-tight">{item.label}</div>
                      <div className="text-[10px] text-muted-foreground/50 leading-tight truncate">{item.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
