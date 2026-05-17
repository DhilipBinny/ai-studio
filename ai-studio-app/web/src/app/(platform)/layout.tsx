"use client";

import { useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { AuthProvider } from "@/lib/auth-context";
import { ChatAssistant } from "@/components/chat-assistant";

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AuthProvider>
      <div className="flex h-screen">
        <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader />
          <main className="flex-1 overflow-auto">
            <div className="p-6 space-y-6">{children}</div>
          </main>
        </div>
      </div>
      <ChatAssistant />
    </AuthProvider>
  );
}
