/**
 * Rail.tsx — horizontal variant filmstrip (T9).
 *
 * Exported API surface (see INTEGRATION.md):
 *   <Rail serverUrl={SERVER_URL} />          — mount once, bottom of the layout
 *   startBatch(batchId: string)              — call from the tool dispatcher right
 *                                              after POST /variants returns {batch_id}
 *   setOnVariantChosen((url, slot) => {})    — register the "user picked this tile"
 *                                              callback (feed it back to the model)
 *
 * Behavior per docs/CONTRACT.md:
 *   - startBatch → 4 pulsing skeleton tiles appear IMMEDIATELY
 *   - polls GET {serverUrl}/variants/{batchId} every 1s
 *   - fills each tile as its slot goes "done"; quietly hides "failed" slots
 *   - stops polling when no slot is "pending"
 *   - tap a tile → fullscreen overlay; tap overlay to dismiss; fires onVariantChosen
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VariantSlot, VariantsPollResponse } from "./types";
import { USE_MOCK, mockPollVariants } from "./mockServer";
import "./rail.css";

/* ------------------------------------------------------------------ */
/* Module-level wiring so non-React code (the tool dispatcher) can talk
   to the mounted Rail without prop drilling.                          */
/* ------------------------------------------------------------------ */

type BatchListener = (batchId: string) => void;
const batchListeners = new Set<BatchListener>();
/** Batches announced before Rail mounted (kickoff race) — replayed on mount. */
const preMountQueue: string[] = [];

/**
 * Tell the rail a new variant batch exists. Call this from web/src/tools.ts
 * immediately after POST /variants returns { batch_id }.
 * Safe to call before the Rail is mounted.
 */
export function startBatch(batchId: string): void {
  if (batchListeners.size === 0) {
    preMountQueue.push(batchId);
    return;
  }
  batchListeners.forEach((l) => l(batchId));
}

export type VariantChosenHandler = (url: string, slot: number) => void;
let variantChosenHandler: VariantChosenHandler | null = null;

/**
 * Register a callback fired when the user taps/enlarges a variant tile.
 * `url` is the full, loadable image URL. Use it to tell the model which
 * design the user picked (and as the keyframe source for /brief or Omni).
 */
export function setOnVariantChosen(cb: VariantChosenHandler | null): void {
  variantChosenHandler = cb;
}

/* ------------------------------------------------------------------ */

interface Batch {
  batchId: string;
  slots: VariantSlot[]; // always 4 entries
  settled: boolean; // no pending slots left → polling stopped
}

const EMPTY_SLOTS: VariantSlot[] = [0, 1, 2, 3].map((slot) => ({
  slot,
  status: "pending",
  url: null,
}));

export interface RailProps {
  serverUrl: string;
}

export default function Rail({ serverUrl }: RailProps) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [enlarged, setEnlarged] = useState<{ url: string; slot: number } | null>(
    null
  );
  const stripRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<Map<string, number>>(new Map());
  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;

  /** "/static/x.jpg" → serverUrl + path; absolute URLs (mock) pass through. */
  const fullUrl = useCallback((u: string) => {
    if (/^https?:\/\//.test(u)) return u;
    const base = serverUrlRef.current.replace(/\/$/, "");
    return base + (u.startsWith("/") ? u : "/" + u);
  }, []);

  const stopPolling = useCallback((batchId: string) => {
    const t = timersRef.current.get(batchId);
    if (t !== undefined) {
      window.clearInterval(t);
      timersRef.current.delete(batchId);
    }
  }, []);

  const pollOnce = useCallback(
    async (batchId: string) => {
      let res: VariantsPollResponse;
      try {
        if (USE_MOCK) {
          res = await mockPollVariants(batchId);
        } else {
          const base = serverUrlRef.current.replace(/\/$/, "");
          const r = await fetch(`${base}/variants/${batchId}`);
          if (!r.ok) return; // transient — keep polling
          res = (await r.json()) as VariantsPollResponse;
        }
      } catch {
        return; // network blip — next tick will retry
      }

      const settled = res.images.every((s) => s.status !== "pending");
      setBatches((prev) =>
        prev.map((b) =>
          b.batchId === batchId ? { ...b, slots: res.images, settled } : b
        )
      );
      if (settled) stopPolling(batchId);
    },
    [stopPolling]
  );

  const beginBatch = useCallback(
    (batchId: string) => {
      setBatches((prev) => {
        if (prev.some((b) => b.batchId === batchId)) return prev;
        return [...prev, { batchId, slots: EMPTY_SLOTS, settled: false }];
      });
      if (!timersRef.current.has(batchId)) {
        pollOnce(batchId); // immediate first poll
        const t = window.setInterval(() => pollOnce(batchId), 1000);
        timersRef.current.set(batchId, t);
      }
      // Newest batch scrolls into view.
      requestAnimationFrame(() => {
        stripRef.current?.scrollTo({
          left: stripRef.current.scrollWidth,
          behavior: "smooth",
        });
      });
    },
    [pollOnce]
  );

  // Subscribe to startBatch() announcements; replay any pre-mount batches.
  useEffect(() => {
    batchListeners.add(beginBatch);
    while (preMountQueue.length > 0) beginBatch(preMountQueue.shift() as string);
    const timers = timersRef.current;
    return () => {
      batchListeners.delete(beginBatch);
      timers.forEach((t) => window.clearInterval(t));
      timers.clear();
    };
  }, [beginBatch]);

  const handleTileTap = (slot: VariantSlot) => {
    if (slot.status !== "done" || !slot.url) return;
    const url = fullUrl(slot.url);
    setEnlarged({ url, slot: slot.slot });
    if (variantChosenHandler) variantChosenHandler(url, slot.slot);
  };

  if (batches.length === 0 && !enlarged) return null;

  return (
    <>
      <div className="ghar-rail" ref={stripRef} aria-label="Design variants">
        {batches.map((batch) =>
          batch.slots
            .filter((s) => s.status !== "failed") // quietly hide failures
            .map((s) => (
              <div
                key={`${batch.batchId}_${s.slot}`}
                className={
                  "ghar-rail-tile" +
                  (s.status === "pending" ? " ghar-rail-tile--skeleton" : "")
                }
                onClick={() => handleTileTap(s)}
                role={s.status === "done" ? "button" : undefined}
              >
                {s.status === "done" && s.url ? (
                  <img src={fullUrl(s.url)} alt={`Variant ${s.slot + 1}`} />
                ) : null}
              </div>
            ))
        )}
      </div>

      {enlarged ? (
        <div
          className="ghar-rail-overlay"
          onClick={() => setEnlarged(null)}
          role="button"
          aria-label="Dismiss enlarged variant"
        >
          <img src={enlarged.url} alt={`Variant ${enlarged.slot + 1} enlarged`} />
          <div className="ghar-rail-overlay-hint">tap anywhere to close</div>
        </div>
      ) : null}
    </>
  );
}
