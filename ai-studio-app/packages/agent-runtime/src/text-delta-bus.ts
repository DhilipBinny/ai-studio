type DeltaCallback = (delta: string) => void;

const subscribers = new Map<string, Set<DeltaCallback>>();

function makeKey(traceId: string, tenantId: string): string {
  return `${tenantId}:${traceId}`;
}

export const textDeltaBus = {
  emit(traceId: string, tenantId: string, delta: string): void {
    const key = makeKey(traceId, tenantId);
    const subs = subscribers.get(key);
    if (!subs || subs.size === 0) return;
    for (const cb of subs) {
      try { cb(delta); } catch { /* subscriber error — non-fatal */ }
    }
  },

  subscribe(traceId: string, tenantId: string, callback: DeltaCallback): () => void {
    const key = makeKey(traceId, tenantId);
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key)!.add(callback);
    return () => {
      const subs = subscribers.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) subscribers.delete(key);
      }
    };
  },
};
