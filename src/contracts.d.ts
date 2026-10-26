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
export type OperationalStage =
  | "draft"
  | "submitted"
  | "intake_validation"
  | "ready_for_review"
  | "under_review"
  | "awaiting_response"
  | "response_received"
  | "reevaluation_required"
  | "pending_clearance"
  | "ready_for_decision"
  | "decision_recorded"
  | "closed";
export interface OperationalAction {
  action:
    | "submit"
    | "intake"
    | "ready"
    | "review"
    | "clarify"
    | "response"
    | "reevaluate"
    | "clearance";
  revision: number;
  inputRevision: number;
  reason: string;
}
export interface SubmissionDraft {
  id: string;
  revision: number;
  case_id: string | null;
  payload: {
    name?: string;
    instrument?: Partial<Instrument>;
    obligation?: { amountPaise: number };
    obligationId?: string;
    confirmedFields?: string[];
    confirmedDocumentId?: string | null;
    step?: number;
  };
}
export interface PDFViewport {
  width: number;
  height: number;
  transform: [number, number, number, number, number, number];
}
export interface EvidenceCoordinates {
  page: number;
  documentVersionId: string | null;
  coordinateSystem: "pdf-points-bottom-left" | "raster-pixels-top-left" | null;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
}
