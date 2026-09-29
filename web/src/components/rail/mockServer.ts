/**
 * mockServer.ts — tiny in-memory fake of the server poll lifecycle, so the rail
 * (and Anupam's tool dispatcher) is demoable before server/ exists.
 *
 * Flip USE_MOCK to false at MERGE M2 when the real FastAPI /variants is live.
 *
 * Lifecycle it simulates: 4 slots, each flipping "pending" -> "done" at
 * ~1.5s / 3s / 4.5s / 6s after the batch's first poll, with placeholder images.
 */

import type { BriefData, VariantsPollResponse, VariantSlot } from "./types";

export const USE_MOCK = false;

/** Ms after first poll at which each slot completes. */
const SLOT_DONE_AT_MS = [1500, 3000, 4500, 6000];

const PLACEHOLDER_URLS = [
  "https://placehold.co/400x300/2a2018/e8ddca?text=Variant+1",
  "https://placehold.co/400x300/1f2a1f/dce8ca?text=Variant+2",
  "https://placehold.co/400x300/2a1f28/e8cade?text=Variant+3",
  "https://placehold.co/400x300/1f242a/cadce8?text=Variant+4",
];

/** batchId -> timestamp of first poll */
const batchStart = new Map<string, number>();

/**
 * Drop-in fake for `GET {serverUrl}/variants/{batchId}`.
 * Rail calls this instead of fetch when USE_MOCK is true.
 */
export async function mockPollVariants(
  batchId: string
): Promise<VariantsPollResponse> {
  if (!batchStart.has(batchId)) batchStart.set(batchId, Date.now());
  const elapsed = Date.now() - (batchStart.get(batchId) as number);

  const images: VariantSlot[] = SLOT_DONE_AT_MS.map((doneAt, slot) => {
    const done = elapsed >= doneAt;
    return {
      slot,
      status: done ? "done" : "pending",
      // Mock returns absolute URLs; real server returns "/static/..." relative
      // paths. Rail prefixes serverUrl only for relative paths, so both work.
      url: done ? PLACEHOLDER_URLS[slot] : null,
    } as VariantSlot;
  });

  return { batch_id: batchId, images };
}

/** The CONTRACT.md example brief, fleshed out to demo-worthy size. */
export const MOCK_BRIEF: BriefData = {
  budget: [
    {
      item: "Rattan armchair",
      estimate_inr: 12500,
      source_url: "https://www.pepperfry.com/",
      note: "estimate",
    },
    {
      item: "Warm-white floor lamp",
      estimate_inr: 4200,
      source_url: "https://www.urbanladder.com/",
      note: "estimate",
    },
    {
      item: "Linen curtains (2 panels)",
      estimate_inr: 3800,
      source_url: "https://www.ikea.com/in/en/",
      note: "estimate",
    },
    {
      item: "Jute area rug 5x7",
      estimate_inr: 6500,
      source_url: "https://www.pepperfry.com/",
      note: "estimate",
    },
    {
      item: "Wall paint, warm neutral (1 wall, labour incl.)",
      estimate_inr: 5000,
      source_url: "https://www.asianpaints.com/",
      note: "estimate",
    },
    {
      item: "Potted plants (areca palm + snake plant)",
      estimate_inr: 1600,
      source_url: "https://www.ugaoo.com/",
      note: "estimate",
    },
  ],
  total_estimate_inr: 33600,
  legal: [
    {
      step: "Society NOC for civil work",
      required: false,
      detail: "Not needed — no civil work in this scope",
    },
    {
      step: "Society intimation for painting",
      required: true,
      detail: "Written intimation to society office; no approval wait",
    },
    {
      step: "Licensed electrician certificate",
      required: true,
      detail: "Required for new lamp wiring point",
    },
    {
      step: "Municipal permission",
      required: false,
      detail: "Not needed — no structural changes",
    },
    {
      step: "Work-hours compliance",
      required: true,
      detail: "Most societies: 9 AM to 6 PM, no Sundays",
    },
  ],
};

/** Drop-in fake for `POST {serverUrl}/brief`. */
export async function mockFetchBrief(): Promise<BriefData> {
  await new Promise((r) => setTimeout(r, 600)); // feels like a real call
  return MOCK_BRIEF;
}
