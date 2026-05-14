"use client";

import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";

import { useState, useEffect, useCallback } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import type { Agent, ProviderModel } from "@ais-app/types";

import { AgentList } from "./components/agent-list";
import { CreateAgentForm, EditAgentForm } from "./components/agent-form";
import { AgentChat } from "./components/agent-chat";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [models, setModels] = useState<ProviderModel[]>([]);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(DEFAULT_PAGE_SIZE) });
    if (statusFilter) params.set("status", statusFilter);
    const res = await fetch(`/api/agents?${params}`);
    if (res.ok) {
      const data = await res.json();
      setAgents(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    }
    setLoading(false);
  }, [page, statusFilter]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.data) setModels(d.data); })
      .catch(() => {});
  }, []);

  return (
    <RequirePermission module="AGENTS"><>
      <PageHeader title="Agents" description="Configure and manage your AI agents.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create Agent</Button>
      </PageHeader>

      <AgentList
        agents={agents}
        total={total}
        totalPages={totalPages}
        page={page}
        loading={loading}
        statusFilter={statusFilter}
        models={models}
        pageSize={DEFAULT_PAGE_SIZE}
        onPageChange={setPage}
        onStatusFilterChange={(status) => { setStatusFilter(status); setPage(1); }}
        onCreateClick={() => setShowCreate(true)}
        onEditClick={setEditAgent}
        onChatClick={setChatAgent}
      />

      <Dialog open={showCreate} onOpenChange={setShowCreate} size="2xl">
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Create Agent</DialogTitle></DialogHeader>
          <CreateAgentForm models={models} onCreated={() => { setShowCreate(false); fetchAgents(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editAgent} onOpenChange={(open) => { if (!open) setEditAgent(null); }} size="2xl">
        <DialogContent onClose={() => setEditAgent(null)}>
          <DialogHeader><DialogTitle>Edit Agent</DialogTitle></DialogHeader>
          {editAgent && <EditAgentForm agent={editAgent} models={models} onSaved={() => { setEditAgent(null); fetchAgents(); }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!chatAgent} onOpenChange={(open) => { if (!open) setChatAgent(null); }} size="3xl">
        <DialogContent onClose={() => setChatAgent(null)} className="h-[80vh] flex flex-col">
          <DialogHeader><DialogTitle>Chat — {chatAgent?.name}</DialogTitle></DialogHeader>
          {chatAgent && <AgentChat agent={chatAgent} />}
        </DialogContent>
      </Dialog>
    </></RequirePermission>
  );
}
