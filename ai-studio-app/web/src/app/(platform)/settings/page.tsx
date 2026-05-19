"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/require-permission";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { GeneralTab } from "./components/general-tab";
import { ProfilesTab } from "./components/profiles-tab";
import { ApiKeysTab } from "./components/api-keys-tab";
import { AdvancedTab } from "./components/advanced-tab";

export default function SettingsPage() {
  const [tab, setTab] = useState("general");
  return (
    <RequirePermission module="SETTINGS"><>
      <PageHeader title="Settings" description="Configure platform settings and access profiles." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralTab /></TabsContent>
        <TabsContent value="profiles"><ProfilesTab /></TabsContent>
        <TabsContent value="api-keys"><ApiKeysTab /></TabsContent>
        <TabsContent value="advanced"><AdvancedTab /></TabsContent>
      </Tabs>
    </></RequirePermission>
  );
}
