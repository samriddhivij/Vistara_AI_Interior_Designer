/**
 * Stage.tsx — the CENTRAL SCREEN of the Vistara app: the design journey,
 * step by step.
 *
 * Render priority (first match wins):
 *   1. tourVideo   — cinematic walkthrough video with caption chip
 *   2. batch       — "Now designing: {area}" header + 2x2 concept grid
 *                    (skeleton tiles pulse while pending, images fade in as
 *                    each lands; clicking a done tile shows a ✓ ring + brief
 *                    zoom, then fires onPick — App clears the batch after)
 *   3. conceptUrl  — the user's locked-in concept, large
 *   4. cameraActive— renders null; App renders the camera <video> behind
 *   5. idle        — friendly invite prompt
 */

import React, { useEffect, useState } from "react";
import "./stage.css";

export interface StageBatchSlot {
  slot: number;
  status: "pending" | "done" | "failed";
  url: string | null;
}

export interface StageBatch {
  /** Optional stable id — used to reset the pick animation between batches. */
  batchId?: string;
  areaName: string;
  slots: StageBatchSlot[]; // always 4 entries
}

export interface StageProps {
  tourVideo: { src: string; caption: string; areaName?: string | null } | null;
  conceptUrl: string | null;
  cameraActive: boolean;
  /** Active concepts batch. App clears this after the user picks a tile. */
  batch: StageBatch | null;
  /** Fired (after a brief ✓ + zoom animation) when a done tile is clicked. */
  onPick: (url: string, slot: number) => void;
  children?: React.ReactNode;
  /** Optional: dismiss the tour video (close button). */
  onCloseTour?: () => void;
  /** Optional: the tour video played to its end (App advances the tour queue). */
  onVideoEnded?: () => void;
}

/** How long the ✓ ring + zoom plays before the pick is committed. */
const PICK_ANIMATION_MS = 650;

export default function Stage({
  tourVideo,
  conceptUrl,
  cameraActive,
  batch,
  onPick,
  children,
  onCloseTour,
  onVideoEnded,
}: StageProps) {
  const [pickedSlot, setPickedSlot] = useState<number | null>(null);

  // Reset the pick animation whenever a different batch takes the stage.
  const batchKey = batch ? batch.batchId ?? batch.areaName : null;
  useEffect(() => {
    setPickedSlot(null);
  }, [batchKey]);

  if (tourVideo) {
    return (
      <div className="ghar-stage ghar-stage--tour">
        <video
          className="ghar-stage-video"
          src={tourVideo.src}
          autoPlay
          controls
          playsInline
          onEnded={() => {
            if (onVideoEnded) onVideoEnded();
            else if (onCloseTour) onCloseTour();
          }}
        />
        {tourVideo.areaName && (
          <div className="ghar-stage-room-chip">{tourVideo.areaName}</div>
        )}
        <div className="ghar-stage-chip">{tourVideo.caption}</div>
        {onCloseTour && (
          <button
            className="ghar-stage-close"
            onClick={onCloseTour}
            aria-label="Close tour"
          >
            ✕
          </button>
        )}
        {children}
      </div>
    );
  }

  if (batch) {
    const pendingCount = batch.slots.filter((s) => s.status === "pending").length;
    const doneCount = batch.slots.filter((s) => s.status === "done").length;

    const handleTileClick = (slot: StageBatchSlot) => {
      if (pickedSlot !== null) return; // a pick is already animating
      if (slot.status !== "done" || !slot.url) return;
      const url = slot.url;
      setPickedSlot(slot.slot);
      window.setTimeout(() => onPick(url, slot.slot), PICK_ANIMATION_MS);
    };

    const statusText =
      pickedSlot !== null
        ? "locking it in…"
        : pendingCount > 0
        ? "sketching concepts…"
        : doneCount > 0
        ? "tap the one that feels like home"
        : "";

    return (
      <div className="ghar-stage ghar-stage--batch">
        <div className="ghar-stage-batch-header">
          <span className="ghar-stage-batch-kicker">Now designing:</span>
          <span className="ghar-stage-batch-area">{batch.areaName}</span>
          {statusText && (
            <span className="ghar-stage-batch-status">{statusText}</span>
          )}
        </div>
        <div className="ghar-stage-grid">
          {batch.slots.map((s) => {
            const isPicked = pickedSlot === s.slot;
            const isDimmed = pickedSlot !== null && !isPicked;
            const className =
              "ghar-stage-tile" +
              (s.status === "pending" ? " ghar-stage-tile--skeleton" : "") +
              (s.status === "failed" ? " ghar-stage-tile--failed" : "") +
              (s.status === "done" ? " ghar-stage-tile--done" : "") +
              (isPicked ? " ghar-stage-tile--picked" : "") +
              (isDimmed ? " ghar-stage-tile--dimmed" : "");
            return (
              <div
                key={s.slot}
                className={className}
                onClick={() => handleTileClick(s)}
                role={s.status === "done" ? "button" : undefined}
                aria-label={
                  s.status === "done"
                    ? `Pick concept ${s.slot + 1}`
                    : undefined
                }
              >
                {s.status === "done" && s.url ? (
                  <img src={s.url} alt={`Concept ${s.slot + 1}`} />
                ) : null}
                {isPicked && <div className="ghar-stage-tile-check">✓</div>}
              </div>
            );
          })}
        </div>
        {children}
      </div>
    );
  }

  if (conceptUrl) {
    return (
      <div className="ghar-stage ghar-stage--concept">
        <img
          className="ghar-stage-image"
          src={conceptUrl}
          alt="Your locked-in design pick"
        />
        <div className="ghar-stage-chip">✓ locked in</div>
        {children}
      </div>
    );
  }

  if (cameraActive) {
    // App renders the camera <video> behind the stage — stay out of the way.
    return null;
  }

  return (
    <div className="ghar-stage ghar-stage--idle">
      <div className="ghar-stage-idle-inner">
        <div className="ghar-stage-idle-title">
          🏠 Describe your dream home to Asha
        </div>
        <div className="ghar-stage-idle-sub">
          e.g. “3BHK, modern techy vibe, one room as a gym” — or upload a photo
          to fix up a real room
        </div>
      </div>
      {children}
    </div>
  );
}
