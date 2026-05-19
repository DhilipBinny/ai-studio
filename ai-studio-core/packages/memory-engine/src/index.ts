export {
  estimateTokens,
  estimateMessageTokens,
  setTokenEstimatorLogger,
  type TokenEstimatorMessage,
} from './token-estimator';

export interface MessageRow {
  id: number;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  metadata: string | null;
  tenant_id?: string;
}

export interface MessageLister {
  listBySession(sessionId: string, limit?: number): Promise<MessageRow[]>;
}
