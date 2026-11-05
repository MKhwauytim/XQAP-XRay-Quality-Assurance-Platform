import type { MessageKey } from "./messages";

/** An engine problem, returned as a value. Page is 1-based. */
export interface EngineIssue {
  rule: MessageKey;
  page?: number;
  visual?: string;
  path?: string;
  detail?: string;
}
