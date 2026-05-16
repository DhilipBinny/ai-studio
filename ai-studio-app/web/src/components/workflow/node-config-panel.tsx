"use client";

import { useState } from "react";
import type { Node } from "@xyflow/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { X, Settings2, Play, Plus, Trash2 } from "lucide-react";
import { NODE_COLOR_MAP, NODE_LABEL_MAP, NODE_ICON_MAP } from "./canvas-types";

import type { AgentSummary, ProviderModel } from "@ais-app/types";

type Agent = AgentSummary;

// ---------------------------------------------------------------------------
// Node Config Panel (right sidebar)
// ---------------------------------------------------------------------------

export function NodeConfigPanel({
  node,
  agents,
  models,
  onUpdate,
  onClose,
  onDelete,
}: {
  node: Node;
  agents: Agent[];
  models: ProviderModel[];
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const data = node.data as Record<string, unknown>;
  const nodeType = data.nodeType as string;
  const config = (data.config || {}) as Record<string, unknown>;
  const errorPolicy = (data.errorPolicy || {}) as Record<string, unknown>;
  const [tab, setTab] = useState<"config" | "error">("config");

  function updateConfig(key: string, value: unknown) {
    const newConfig = { ...config, [key]: value };
    onUpdate(node.id, { ...data, config: newConfig });
  }

  function updateErrorPolicy(key: string, value: unknown) {
    const newPolicy = { ...errorPolicy, [key]: value };
    onUpdate(node.id, { ...data, errorPolicy: newPolicy });
  }

  function updateName(name: string) {
    onUpdate(node.id, { ...data, label: name });
  }

  return (
    <div className="w-72 shrink-0 border-l border-border bg-card overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          {(() => { const Icon = NODE_ICON_MAP[nodeType] || Play; const c = NODE_COLOR_MAP[nodeType] || "#6b7280"; return (
            <div className="flex items-center justify-center w-6 h-6 rounded-md" style={{ backgroundColor: `${c}15` }}>
              <Icon className="w-3.5 h-3.5" style={{ color: c }} />
            </div>
          ); })()}
          <span className="text-xs font-semibold">{NODE_LABEL_MAP[nodeType]}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onDelete(node.id)} className="text-muted-foreground hover:text-destructive p-1" title="Delete node">
            <X className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1" title="Close panel">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex border-b border-border">
        <button onClick={() => setTab("config")} className={`flex-1 text-[11px] py-1.5 font-medium ${tab === "config" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}>Config</button>
        <button onClick={() => setTab("error")} className={`flex-1 text-[11px] py-1.5 font-medium ${tab === "error" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}>Error Policy</button>
      </div>

      <div className="p-3 space-y-3">
        {tab === "config" && (
          <>
            <div className="space-y-1">
              <Label className="text-[11px]">Node Name</Label>
              <Input value={(data.label as string) || ""} onChange={(e) => updateName(e.target.value)} className="h-8 text-xs" />
            </div>

            {nodeType === "agent" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Agent</Label>
                  <Select value={(config.agentId as string) || ""} onChange={(e) => updateConfig("agentId", e.target.value)} className="text-xs">
                    <option value="">Select agent...</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Message template</Label>
                  <Textarea value={(config.message as string) || ""} onChange={(e) => updateConfig("message", e.target.value)} rows={3} className="font-mono text-[11px]" placeholder="Summarize: {{input.text}}" />
                </div>
              </>
            )}

            {nodeType === "llm" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Model</Label>
                  <Select value={(config.providerModelId as string) || ""} onChange={(e) => updateConfig("providerModelId", e.target.value)} className="text-xs">
                    <option value="">Select model...</option>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.providerName})</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">System Prompt</Label>
                  <Textarea value={(config.systemPrompt as string) || ""} onChange={(e) => updateConfig("systemPrompt", e.target.value)} rows={2} className="font-mono text-[11px]" placeholder="You are a helpful assistant." />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">User Message</Label>
                  <Textarea value={(config.userMessage as string) || ""} onChange={(e) => updateConfig("userMessage", e.target.value)} rows={3} className="font-mono text-[11px]" placeholder="{{input.text}}" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Temperature</Label>
                    <Input type="number" step="0.1" min="0" max="2" value={(config.temperature as number) ?? 0.7} onChange={(e) => updateConfig("temperature", parseFloat(e.target.value))} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Max Tokens</Label>
                    <Input type="number" min="1" value={(config.maxTokens as number) ?? 4096} onChange={(e) => updateConfig("maxTokens", parseInt(e.target.value))} className="h-7 text-xs" />
                  </div>
                </div>
              </>
            )}

            {nodeType === "condition" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Expression</Label>
                <Textarea value={(config.expression as string) || ""} onChange={(e) => updateConfig("expression", e.target.value)} rows={2} className="font-mono text-[11px]" placeholder={'{{reviewer.response}} contains "high risk"'} />
                <p className="text-[10px] text-muted-foreground">Operators: contains, equals, greater_than, less_than, is_empty</p>
              </div>
            )}

            {nodeType === "switch" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Value to evaluate</Label>
                  <Input value={(config.value as string) || ""} onChange={(e) => updateConfig("value", e.target.value)} className="h-8 text-xs font-mono" placeholder="{{classifier.category}}" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Cases</Label>
                  {((config.cases as string[]) || []).map((c, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <Input
                        value={c}
                        onChange={(e) => {
                          const updated = [...((config.cases as string[]) || [])];
                          updated[i] = e.target.value;
                          updateConfig("cases", updated);
                        }}
                        className="h-7 text-xs flex-1"
                        placeholder={`Case ${i + 1}`}
                      />
                      <button
                        onClick={() => {
                          const updated = ((config.cases as string[]) || []).filter((_, idx) => idx !== i);
                          updateConfig("cases", updated);
                        }}
                        className="text-muted-foreground hover:text-destructive p-0.5"
                        title="Remove case"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const updated = [...((config.cases as string[]) || []), ""];
                      updateConfig("cases", updated);
                    }}
                    className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium"
                  >
                    <Plus className="h-3 w-3" /> Add Case
                  </button>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Default case</Label>
                  <Input value={(config.defaultCase as string) || ""} onChange={(e) => updateConfig("defaultCase", e.target.value)} className="h-8 text-xs" placeholder="default" />
                </div>
              </>
            )}

            {nodeType === "loop" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Mode</Label>
                  <Select value={(config.mode as string) || "while"} onChange={(e) => updateConfig("mode", e.target.value)} className="text-xs">
                    <option value="while">While condition</option>
                    <option value="for_count">Fixed count</option>
                  </Select>
                </div>
                {(config.mode || "while") === "while" && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">Condition</Label>
                    <Input value={(config.condition as string) || ""} onChange={(e) => updateConfig("condition", e.target.value)} className="h-8 text-xs font-mono" placeholder="{{_loop.counter}} less_than 5" />
                  </div>
                )}
                {config.mode === "for_count" && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">Count</Label>
                    <Input type="number" min="1" value={(config.maxCount as number) ?? 5} onChange={(e) => updateConfig("maxCount", parseInt(e.target.value))} className="h-7 text-xs" />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-[11px]">Max iterations (safety)</Label>
                  <Input type="number" min="1" max="1000" value={(config.maxIterations as number) ?? 100} onChange={(e) => updateConfig("maxIterations", parseInt(e.target.value))} className="h-7 text-xs" />
                </div>
              </>
            )}

            {nodeType === "iteration" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Array path</Label>
                  <Input value={(config.arrayPath as string) || ""} onChange={(e) => updateConfig("arrayPath", e.target.value)} className="h-8 text-xs font-mono" placeholder="{{input.documents}}" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Parallel</Label>
                    <Select value={config.parallel ? "true" : "false"} onChange={(e) => updateConfig("parallel", e.target.value === "true")} className="text-xs">
                      <option value="false">Sequential</option>
                      <option value="true">Parallel</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Batch size</Label>
                    <Input type="number" min="1" max="50" value={(config.batchSize as number) ?? 5} onChange={(e) => updateConfig("batchSize", parseInt(e.target.value))} className="h-7 text-xs" />
                  </div>
                </div>
              </>
            )}

            {nodeType === "delay" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Delay (ms)</Label>
                <Input type="number" min="0" max="300000" value={(config.delayMs as number) ?? 1000} onChange={(e) => updateConfig("delayMs", parseInt(e.target.value))} className="h-7 text-xs" />
                <p className="text-[10px] text-muted-foreground">Max 300,000ms (5 min)</p>
              </div>
            )}

            {nodeType === "http_request" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Method</Label>
                    <Select value={(config.method as string) || "GET"} onChange={(e) => updateConfig("method", e.target.value)} className="text-xs">
                      <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-[11px]">URL</Label>
                    <Input value={(config.url as string) || ""} onChange={(e) => updateConfig("url", e.target.value)} className="h-8 text-xs font-mono" placeholder="https://api.example.com/data" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Body (JSON template)</Label>
                  <Textarea value={(config.body as string) || ""} onChange={(e) => updateConfig("body", e.target.value)} rows={3} className="font-mono text-[11px]" placeholder='{"query": "{{input.text}}"}' />
                </div>
              </>
            )}

            {nodeType === "code" && (
              <div className="space-y-1">
                <Label className="text-[11px]">JavaScript code</Label>
                <Textarea value={(config.code as string) || ""} onChange={(e) => updateConfig("code", e.target.value)} rows={6} className="font-mono text-[11px]" placeholder={"const items = JSON.parse(state.input.data);\nreturn { count: items.length };"} />
                <p className="text-[10px] text-muted-foreground">Receives `state` object. Return a plain object. 5s timeout.</p>
              </div>
            )}

            {nodeType === "sub_workflow" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Workflow ID</Label>
                <Input value={(config.workflowId as string) || ""} onChange={(e) => updateConfig("workflowId", e.target.value)} className="h-8 text-xs font-mono" placeholder="UUID of target workflow" />
              </div>
            )}

            {nodeType === "knowledge_search" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Knowledge Base ID</Label>
                  <Input value={(config.knowledgeBaseId as string) || ""} onChange={(e) => updateConfig("knowledgeBaseId", e.target.value)} className="h-8 text-xs font-mono" placeholder="UUID of knowledge base" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Query template</Label>
                  <Input value={(config.query as string) || ""} onChange={(e) => updateConfig("query", e.target.value)} className="h-8 text-xs font-mono" placeholder="{{input.question}}" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Max results</Label>
                  <Input type="number" min="1" max="50" value={(config.topK as number) ?? 5} onChange={(e) => updateConfig("topK", parseInt(e.target.value))} className="h-7 text-xs" />
                </div>
              </>
            )}

            {nodeType === "tool" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Tool name</Label>
                  <Input value={(config.toolName as string) || ""} onChange={(e) => updateConfig("toolName", e.target.value)} className="h-8 text-xs font-mono" placeholder="read_file, web_fetch, etc." />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Arguments (JSON)</Label>
                  <Textarea
                    value={JSON.stringify(config.arguments || {}, null, 2)}
                    onChange={(e) => { try { updateConfig("arguments", JSON.parse(e.target.value)); } catch {} }}
                    rows={3} className="font-mono text-[11px]"
                    placeholder={'{"path": "{{input.filePath}}"}'}
                  />
                </div>
              </>
            )}

            {nodeType === "human_review" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Prompt</Label>
                  <Textarea value={(config.prompt as string) || ""} onChange={(e) => updateConfig("prompt", e.target.value)} rows={2} className="text-[11px]" placeholder="Please review and approve." />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Review type</Label>
                  <Select value={(config.reviewType as string) || "approve_deny"} onChange={(e) => updateConfig("reviewType", e.target.value)} className="text-xs">
                    <option value="approve_deny">Approve / Deny</option>
                    <option value="choice">Multiple choice</option>
                    <option value="form">Custom form</option>
                  </Select>
                </div>
              </>
            )}

            {nodeType === "transform" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Mappings (JSON)</Label>
                <Textarea
                  value={JSON.stringify(config.mappings || [], null, 2)}
                  onChange={(e) => { try { updateConfig("mappings", JSON.parse(e.target.value)); } catch {} }}
                  rows={4} className="font-mono text-[11px]"
                  placeholder={'[{"key":"summary","value":"{{agent.response}}"}]'}
                />
              </div>
            )}

            {nodeType === "aggregate" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Strategy</Label>
                <Select value={(config.strategy as string) || "merge"} onChange={(e) => updateConfig("strategy", e.target.value)} className="text-xs">
                  <option value="merge">Merge (shallow)</option>
                  <option value="array">Collect as array</option>
                  <option value="first">First result</option>
                </Select>
              </div>
            )}
          </>
        )}

        {tab === "error" && (
          <>
            <div className="space-y-1">
              <Label className="text-[11px]">On Error</Label>
              <Select value={(errorPolicy.onError as string) || "stop"} onChange={(e) => updateErrorPolicy("onError", e.target.value)} className="text-xs">
                <option value="stop">Stop workflow</option>
                <option value="continue">Continue (skip)</option>
                <option value="error_branch">Route to error branch</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Max Retries</Label>
              <Input type="number" min="0" max="10" value={(errorPolicy.maxRetries as number) ?? 0} onChange={(e) => updateErrorPolicy("maxRetries", parseInt(e.target.value))} className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Retry Delay (ms)</Label>
              <Input type="number" min="100" max="60000" value={(errorPolicy.retryDelayMs as number) ?? 1000} onChange={(e) => updateErrorPolicy("retryDelayMs", parseInt(e.target.value))} className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Backoff</Label>
              <Select value={(errorPolicy.retryBackoff as string) || "fixed"} onChange={(e) => updateErrorPolicy("retryBackoff", e.target.value)} className="text-xs">
                <option value="fixed">Fixed delay</option>
                <option value="exponential">Exponential</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Timeout (ms)</Label>
              <Input type="number" min="0" max="600000" value={(errorPolicy.timeoutMs as number) ?? 0} onChange={(e) => updateErrorPolicy("timeoutMs", parseInt(e.target.value))} className="h-7 text-xs" />
              <p className="text-[10px] text-muted-foreground">0 = no timeout (uses workflow default)</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
