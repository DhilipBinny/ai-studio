import type { Metadata } from "next";
import { BRAND_NAME } from "@ais-app/types";
import "./globals.css";

export const metadata: Metadata = {
  title: BRAND_NAME,
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
