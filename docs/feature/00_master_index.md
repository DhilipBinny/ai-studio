# Echol AI Studio — Master Feature Index

**Generated:** 2026-05-15
**Verified:** 3-iteration process (draft → cross-verify against code → fix inaccuracies)
**Total:** 14 domain documents, 360 KB, covering the complete platform

---

## Platform Overview

Echol AI Studio is an enterprise agentic AI platform for configuring, deploying, and monitoring AI agents. It supports multi-tenant isolation, visual workflow orchestration, RAG-powered knowledge bases, real-time observability, and a comprehensive admin console.

**Tech Stack:** Next.js 16 + TypeScript + Tailwind CSS v4 + shadcn/ui + PostgreSQL 17 + pgvector + Qdrant (optional) + Drizzle ORM

---

## Document Index

| # | Document | Scope | Size |
|---|----------|-------|------|
| 01 | [Authentication](01_authentication.md) | Login, JWT, refresh, OTP/2FA, password reset, lockout, cookies, encryption | 27 KB |
| 02 | [Authorization](02_authorization.md) | RBAC, profiles, permissions, middleware, RLS, multi-tenant, API keys | 30 KB |
| 03 | [Agents](03_agents.md) | Agent CRUD, personas, rules, tool/KB/connector assignments, versioning | 24 KB |
| 04 | [Sessions](04_sessions.md) | Session runner, messages, tool calls, approval flow, cost tracking, compaction | 38 KB |
| 05 | [Workflows](05_workflows.md) | Canvas, 17 node types, expression engine, graph executor, runs, retry, recovery | 31 KB |
| 06 | [Tools](06_tools.md) | Tool registry, 15 builtins, risk levels, MCP integration, approval flow, agentic RAG | 26 KB |
| 07 | [Knowledge Bases](07_knowledge_bases.md) | RAG pipeline, 8 enhancement strategies, chunking, embedding, hybrid search, RRF, re-ranking, RAGAS evaluation, GraphRAG, Qdrant dual-store | 42 KB |
| 08 | [Providers](08_providers.md) | 7 provider types, encryption, model discovery, SSRF protection, OAuth | 22 KB |
| 09 | [Connectors](09_connectors.md) | 5 connector types, credentials encryption, MCP testing | 14 KB |
| 10 | [Observability](10_observability.md) | ProgressBus, SSE streaming, spans, event feed, historical queries | 17 KB |
| 11 | [Workspace](11_workspace.md) | File browser, 3 scopes, path traversal protection, preview/download | 10 KB |
| 12 | [Admin](12_admin.md) | Users, profiles, settings, audit log, cron jobs, API keys, dashboard | 26 KB |
| 13 | [Security](13_security.md) | All security measures consolidated (auth, crypto, SSRF, RLS, injection, RAG tenant isolation) | 25 KB |
| 14 | [Infrastructure](14_infrastructure.md) | PostgreSQL, Qdrant, Docker, Drizzle, migrations (21), Next.js config, health, dev setup | 28 KB |
| 15 | [Testing Standards](15_testing_standards.md) | Test architecture, Vitest setup, LLM mocking, coverage targets | — |
| 16 | [RAG Overhaul Design](16_rag_overhaul_design.md) | RAG v2 architecture, HyDE, contextual retrieval, late chunking | — |
| 17 | [Canvas Overhaul Design](17_canvas_overhaul_design.md) | Workflow canvas v2 architecture, node improvements | — |
| 18 | [Multi-Agent Framework](18_multi_agent_framework.md) | Shared project workspace, invoke_agent tool, auto-approve, one-shot sessions | — |

---

## Module Map

| Module | Sidebar Section | UI Route | API Base | RBAC Module |
|--------|----------------|----------|----------|-------------|
| Dashboard | Main | `/dashboard` | `/api/dashboard/*` | DASHBOARD |
| Agents | Build | `/agents` | `/api/agents/*` | AGENTS |
| Tools | Build | `/tools` | `/api/tools/*` | TOOLS |
| Knowledge Bases | Build | `/knowledge` | `/api/knowledge-bases/*` | KNOWLEDGE |
| Workflows | Build | `/workflows` | `/api/workflows/*` | WORKFLOWS |
| Sessions | Operate | `/runs` | `/api/runs/*` | RUNS |
| Scheduled Jobs | Operate | `/scheduled` | `/api/cron-jobs/*` | SCHEDULED |
| Connectors | Operate | `/connectors` | `/api/connectors/*` | CONNECTORS |
| Providers | Operate | `/providers` | `/api/providers/*` | PROVIDERS |
| Workspace | Operate | `/workspace` | `/api/workspace/*` | WORKSPACE |
| Users | Admin | `/users` | `/api/users/*` | USERS |
| Audit Log | Admin | `/audit-log` | `/api/audit-log` | AUDIT |
| Settings | Admin | `/settings` | `/api/settings` | SETTINGS |
| Profiles | Hidden | — | `/api/profiles/*` | PROFILES |

---

## Database Summary

- **36 tables** with Row-Level Security (FORCE enabled)
- **21 migrations** (001-021), migration 011 is TypeScript (manual)
- **15 PostgreSQL enums**
- **Connection:** globalThis singleton, pool max 10, Drizzle ORM
- **Vector DB:** PostgreSQL pgvector (default) or Qdrant (toggle via `VECTOR_DB=qdrant`)

---

## Test Coverage

| Area | Tests | Files | Notes |
|------|-------|-------|-------|
| RAG engine unit tests | 132 | 11 | chunker, RRF, HyDE, contextual enrichment, evaluator, graph extraction, graph search, late chunking, merge results, multimodal, query decomposition |
| Qdrant store unit tests | 20 | 1 | QdrantSearchStore, QdrantDocumentStore, QdrantGraphStore |
| Qdrant integration tests | 11 | 1 | End-to-end with Qdrant container |
| RAG integration tests | 23 | 1 | End-to-end RAG pipeline |
| **Platform total** | **410+** | — | All packages combined |

---

## Known Gaps (Found During Verification)

These are code-level issues discovered during the 3-iteration documentation process:

| # | Gap | Severity | Status | Doc Reference |
|---|-----|----------|--------|---------------|
| 1 | `accessRightsSchema` missing SCHEDULED + WORKSPACE modules (12/14) | Medium | **Fixed** — SCHEDULED + WORKSPACE added | 02_authorization.md |
| 2 | `knowledge_search` workflow node registered but no handler (throws at runtime) | Medium | **Fixed** — handler implemented with lazy import | 05_workflows.md |
| 3 | Anthropic provider test timeout not wired up (no AbortController) | Low | **Fixed** — AbortController wired up | 08_providers.md |
| 4 | `echo` tool missing from risk-map and category-map (won't auto-seed) | Low | **Fixed** — added to risk-map, category-map, and seeding list | 06_tools.md |
| 5 | OTP verify doesn't check `isLocked` on user | Medium | **Fixed** — isLocked check added | 02_authorization.md |
| 6 | MCP SSE transport documented but throws "not yet supported" | Low | Deferred | 09_connectors.md |
| 7 | `vm.runInNewContext` sandbox escape risk (Docker sidecar designed, not built) | High | Deferred | 05_workflows.md |
| 8 | In-memory rate limiter doesn't survive restarts or multi-instance | Medium | Deferred | 13_security.md |
| 9 | Middleware JWT verify doesn't validate issuer/audience | Low | **Fixed** — issuer + audience validated | 01_authentication.md |
| 10 | `provider-test.ts` duplicated between app layer and core package | Low | **Fixed** — stale core copy removed | 08_providers.md |

**Summary:** 7 Fixed, 3 Deferred.

---

## How to Use These Docs

**To reproduce the platform from scratch:** Read docs 14 → 01 → 02 → 03-12 → 13 (infra first, then auth, then features, then security audit).

**To audit a specific feature:** Find the domain doc, check the API endpoints table, DB tables section, and security measures.

**To onboard a new developer:** Start with 00 (this index), then 14 (infrastructure), then the domain they'll work on.

**To plan improvements:** Check the Known Gaps table above and each doc's "Known Gaps" sections.
