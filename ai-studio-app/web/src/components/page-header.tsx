interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">{description || title}</p>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
