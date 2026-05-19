"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/require-permission";
import { KBListView } from "./components/kb-list-view";
import { KBDetailView } from "./components/kb-detail-view";

export default function KnowledgePage() {
  const [selectedKB, setSelectedKB] = useState<string | null>(null);

  if (selectedKB) {
    return (
      <RequirePermission module="KNOWLEDGE">
        <KBDetailView kbId={selectedKB} onBack={() => setSelectedKB(null)} />
      </RequirePermission>
    );
  }

  return (
    <RequirePermission module="KNOWLEDGE">
      <KBListView onSelect={setSelectedKB} />
    </RequirePermission>
  );
}
