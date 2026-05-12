import { ShieldX } from "lucide-react";

export function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <ShieldX className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-sm font-semibold">Access Denied</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        You don&apos;t have permission to view this page.
      </p>
    </div>
  );
}
