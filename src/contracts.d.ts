export type Role =
  | "institution"
  | "institution_admin"
  | "officer"
  | "supervisor"
  | "audit_reviewer";
export interface Instrument {
  reference: string;
  amountPaise: number;
  bank: string;
  ifsc: string;
  issued: string;
  matures: string;
  type?: "FDR" | "TERM_DEPOSIT";
  currency?: "INR";
  branch?: string;
  institutionName?: string;
  depositor?: string;
}
export interface RevisionedAction {
  revision: number;
  reason: string;
  action?: string;
}
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface Evidence<T = unknown> {
  id: string;
  case_id: string;
  kind: string;
  payload: T;
  created: string;
  actor: string;
}
export interface Finding {
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  sources: unknown[];
}
export interface PrivateStorage {
  path(id: string): string;
  write(id: string, bytes: Uint8Array): void;
  read(id: string): Uint8Array;
  remove(id: string): void;
  recover?(keys: string[]): number;
}
export function validateEnvelope(body: unknown): Record<string, unknown>;
