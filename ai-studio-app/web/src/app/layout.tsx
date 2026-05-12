import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Echol AI Studio",
  description: "Enterprise Agentic AI Platform",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
