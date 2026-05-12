import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Card className="border-dashed">
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
        {actionLabel && onAction && (
          <Button onClick={onAction} size="sm" className="mt-4">
            {actionLabel}
          </Button>
        )}
      </div>
    </Card>
  );
}
