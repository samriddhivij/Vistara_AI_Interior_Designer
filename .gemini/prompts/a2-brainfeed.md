You are Agent A2 for Dev A (Anupam). Execute T7 from TASKBOARD.md.

BEFORE CODING, read fully: TASKBOARD.md (T7), docs/CONTRACT.md (brain-feed event store
section), web/src/components/rail/types.ts (the FeedEvent type — it is law).

FILE SCOPE (hard rule): create/modify ONLY web/src/state/events.ts and files under
web/src/components/brainfeed/. Nothing else — not tools.ts, not rail/, not server/,
not docs/. NEVER run git commit or git push.

## Step 1 — DO THIS FIRST, within your first 5 minutes
Create web/src/state/events.ts exporting EXACTLY these signatures (Agent A1 is coding
against them in parallel — changing them breaks the build):
  export function logEvent(e: FeedEvent): void
  export function subscribe(cb: (events: FeedEvent[]) => void): () => void
Implementation: module-level FeedEvent[] + listener set; import type { FeedEvent } from
"../components/rail/types". Cap the array at ~200 events.

## Step 2 — the brain feed panel
web/src/components/brainfeed/BrainFeed.tsx + brainfeed.css:
- Slim right-side vertical ticker, collapsible; dark translucent, monospace, quiet.
  It is a SIDE PANEL — visually subordinate to the camera view (event rules ban
  dashboard-as-main-feature). Class prefix "ghar-bf-" to avoid collisions.
- Renders the subscribe() stream, newest at bottom, auto-scroll:
    👁 observation → text · 🔧 tool_call → name(args JSON, truncated) ·
    🖼 images → "4 variants · {done} done · {ms}ms" · 📝 note → text
- Timestamps as +mm:ss since first event.
- Export function demoFeed(): logs a scripted 8-event sequence with realistic delays
  so the human can see the panel working with NO live session.

DoD: with demoFeed() (and later a real session), events render in real time in the
panel. FINISH by printing: files changed + how to trigger demoFeed().
