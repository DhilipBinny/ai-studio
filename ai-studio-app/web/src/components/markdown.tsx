"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className || "prose prose-sm dark:prose-invert max-w-none"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse w-full" {...props}>{children}</table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th className="border border-border px-2 py-1 bg-muted text-left font-medium" {...props}>{children}</th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-border px-2 py-1" {...props}>{children}</td>
          ),
          pre: ({ children, ...props }) => (
            <pre className="bg-muted rounded-md p-3 overflow-x-auto text-xs my-2" {...props}>{children}</pre>
          ),
          code: ({ children, className: codeClass, ...props }) => {
            const isInline = !codeClass;
            return isInline
              ? <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>{children}</code>
              : <code className={codeClass} {...props}>{children}</code>;
          },
          blockquote: ({ children, ...props }) => (
            <blockquote className="border-l-2 border-border pl-3 my-2 text-muted-foreground" {...props}>{children}</blockquote>
          ),
          ul: ({ children, ...props }) => (
            <ul className="list-disc pl-4 my-1 space-y-0.5" {...props}>{children}</ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="list-decimal pl-4 my-1 space-y-0.5" {...props}>{children}</ol>
          ),
          h1: ({ children, ...props }) => <h1 className="text-base font-bold mt-3 mb-1" {...props}>{children}</h1>,
          h2: ({ children, ...props }) => <h2 className="text-sm font-bold mt-3 mb-1" {...props}>{children}</h2>,
          h3: ({ children, ...props }) => <h3 className="text-sm font-semibold mt-2 mb-1" {...props}>{children}</h3>,
          hr: (props) => <hr className="my-2 border-border" {...props} />,
          p: ({ children, ...props }) => <p className="my-1" {...props}>{children}</p>,
          a: ({ children, href, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline" {...props}>{children}</a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
