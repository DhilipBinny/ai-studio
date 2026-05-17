"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-md bg-background/80 border border-border/50 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted"
      aria-label="Copy code"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return "";
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className || "prose prose-sm dark:prose-invert max-w-none"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
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
            <div className="group relative my-2">
              <pre className="bg-muted rounded-md p-3 overflow-x-auto text-xs" {...props}>{children}</pre>
              <CopyButton text={extractText(children)} />
            </div>
          ),
          code: ({ children, className: codeClass, ...props }) => {
            const isInline = !codeClass;
            return isInline
              ? <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>{children}</code>
              : <code className={cn(codeClass, "text-xs")} {...props}>{children}</code>;
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
          a: ({ children, href, ...props }) => {
            const safe = href && (href.startsWith("http") || href.startsWith("/") || href.startsWith("#") || href.startsWith("mailto:"));
            return <a href={safe ? href : "#"} target="_blank" rel="noopener noreferrer" className="text-primary underline" {...props}>{children}</a>;
          },
          img: ({ src, alt, ...props }) => (
            <img src={src} alt={alt || ""} className="max-w-full h-auto rounded-md my-2" loading="lazy" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
