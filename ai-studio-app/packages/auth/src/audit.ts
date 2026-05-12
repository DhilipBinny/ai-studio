import { createHash } from "node:crypto";

function lengthPrefix(value: string): string {
  return `${value.length}:${value}`;
}

export function computeAuditHash(params: {
  prevHash: string;
  action: string;
  userId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}): string {
  const parts = [
    lengthPrefix(params.prevHash),
    lengthPrefix(params.action),
    lengthPrefix(params.userId ?? ""),
    lengthPrefix(params.resourceType ?? ""),
    lengthPrefix(params.resourceId ?? ""),
    lengthPrefix(JSON.stringify(params.details, Object.keys(params.details).sort())),
    lengthPrefix(params.createdAt),
  ];

  return createHash("sha256").update(parts.join("")).digest("hex");
}
