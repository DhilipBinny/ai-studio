import { NextRequest, NextResponse } from "next/server";
import { paginationSchema } from "@ais-app/validation";
import { withRBAC } from "@/lib/api-utils";
import { getSessions } from "@/lib/services/session";

export const GET = withRBAC("RUNS", 10, async (request, auth) => {
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const status = url.searchParams.get("status");
  const agentId = url.searchParams.get("agentId");

  const result = await getSessions(auth.tenantId, {
    page: pagination.page,
    pageSize: pagination.pageSize,
    status,
    agentId,
  });

  return NextResponse.json(result);
});
