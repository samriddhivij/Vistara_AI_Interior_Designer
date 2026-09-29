/**
 * types.ts — TS mirrors of docs/CONTRACT.md. CONTRACT.md is law; if these ever
 * disagree with it, the contract wins and this file is the bug.
 */

/* ---------- GET /variants/{batch_id} ---------- */

export type VariantSlotStatus = "pending" | "done" | "failed";

export interface VariantSlot {
  slot: number; // 0..3
  status: VariantSlotStatus;
  /** Relative path like "/static/b_123_0.jpg" when done, null otherwise.
   *  (Mock server returns absolute https URLs — Rail handles both.) */
  url: string | null;
}

export interface VariantsPollResponse {
  batch_id: string;
  images: VariantSlot[];
}

/* ---------- POST /brief response ---------- */

export interface BudgetLine {
  item: string;
  estimate_inr: number;
  /** Grounded vendor link, or null when no good link was found (never invented). */
  source_url: string | null;
  note: string; // always "estimate" per contract
}

export interface LegalStep {
  step: string;
  required: boolean;
  detail: string;
}

export interface BriefData {
  budget: BudgetLine[];
  total_estimate_inr: number;
  legal: LegalStep[];
}

/* ---------- Brain-feed event store (web/src/state/events.ts, Anupam owns) ---------- */

export type FeedEvent =
  | { kind: "observation"; text: string; t: number } // 👁 model noticed something
  | { kind: "tool_call"; name: string; args: object; t: number } // 🔧 self-initiated call
  | { kind: "images"; batchId: string; done: number; ms: number; t: number } // 🖼
  | { kind: "note"; text: string; t: number }; // 📝 (stretch: preferences)
