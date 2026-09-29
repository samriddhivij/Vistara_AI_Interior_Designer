# rail/ — integration notes for Anupam

Self-contained drop-in. Everything lives in `web/src/components/rail/`; the only
external import is `react`. Plain CSS in `rail.css` (imported by the components
themselves — you don't need to import it). No UI library, no state library.

## One-line imports

```ts
import Rail, { startBatch, setOnVariantChosen } from "./components/rail/Rail";
import BriefScreen from "./components/rail/BriefScreen";
import { USE_MOCK, mockFetchBrief } from "./components/rail/mockServer";
import type { BriefData, VariantsPollResponse, FeedEvent } from "./components/rail/types";
```

## Mounting

```tsx
// Anywhere in your top-level layout (it renders as a fixed bottom strip, ~120px):
<Rail serverUrl={SERVER_URL} />

// Brief screen — you own the visibility state:
<BriefScreen brief={brief} visible={showBrief} onClose={() => setShowBrief(false)} />
```

`SERVER_URL` = `http://<your-laptop-LAN-ip>:8000` per CONTRACT.md env section.

## Wiring point 1 — `generate_variants` tool call (in your tool dispatcher, web/src/tools.ts)

```ts
// after the Live model fires generate_variants(description):
const res = await fetch(`${SERVER_URL}/variants`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ description, keyframe_b64 }),
});
const { batch_id } = await res.json();   // returns in <500ms, before images exist
startBatch(batch_id);                     // <-- THE wiring line. Rail takes over:
// 4 pulsing skeletons appear instantly, it polls GET /variants/{batch_id} every 1s,
// fills tiles as slots go "done", hides "failed", stops when nothing is pending.
```

While `USE_MOCK` is `true` (flip it in `mockServer.ts` at M2), the rail ignores
the network entirely and self-fills over ~6s with placeholder images — so you can
call `startBatch("any-string")` from the mock dispatcher without a server.
`startBatch` is safe to call before `<Rail>` has mounted (queued and replayed).

## Wiring point 2 — `compile_brief` tool call

```ts
// on compile_brief: show the screen immediately (it renders "Compiling brief…"
// while brief is null), then fill it when the POST resolves.
setShowBrief(true);
const brief: BriefData = USE_MOCK
  ? await mockFetchBrief()
  : await (await fetch(`${SERVER_URL}/brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: chosenDescription, objects }),
    })).json();
setBrief(brief);
```

## Telling the model which variant the user picked

```ts
setOnVariantChosen((url, slot) => {
  // Fires when a tile is tapped/enlarged. Send this back into the Live session
  // (e.g. inject "user selected variant ${slot + 1}") and/or stash `url` as the
  // chosen design for /brief and play_scene.
});
```

Register once at startup (it's a module-level setter, not a prop). Pass `null`
to unregister.

## API surface (complete)

| Export | From | Signature |
|---|---|---|
| `Rail` (default) | `Rail.tsx` | `({ serverUrl: string }) => JSX` |
| `startBatch` | `Rail.tsx` | `(batchId: string) => void` |
| `setOnVariantChosen` | `Rail.tsx` | `(cb: ((url: string, slot: number) => void) \| null) => void` |
| `BriefScreen` (default) | `BriefScreen.tsx` | `({ brief: BriefData \| null; visible: boolean; onClose: () => void }) => JSX` |
| `USE_MOCK` | `mockServer.ts` | `boolean` — flip to `false` at M2 |
| `mockFetchBrief` | `mockServer.ts` | `() => Promise<BriefData>` |
| `MOCK_BRIEF` | `mockServer.ts` | the cached demo brief object |
| types | `types.ts` | `VariantsPollResponse`, `VariantSlot`, `BriefData`, `BudgetLine`, `LegalStep`, `FeedEvent` |

## Styling assumptions

- Rail: `position: fixed` bottom strip, ~120px tall (140px ≥700px wide), dark
  translucent background, horizontal scroll, z-index 40. Keep your camera view
  full-bleed behind it; give your own bottom UI ~120px clearance.
- Enlarge overlay: z-index 60 fullscreen, tap anywhere to dismiss.
- Brief screen: z-index 70 fullscreen dark panel, scrollable, close button top-right.
- All class names are prefixed `ghar-` — no collisions with the starter's CSS.
- Image URLs: relative paths from the server (`/static/...`) are prefixed with
  `serverUrl`; absolute URLs (mock placeholders) pass through unchanged.

## Behavior notes

- Rail renders `null` until the first `startBatch` — zero footprint at session start.
- Multiple batches append to the strip (the "less wood, more plants" re-fire beat);
  newest batch auto-scrolls into view. Failed slots simply never appear — no error UI.
- Poll errors/network blips are swallowed; the next 1s tick retries.
- "Send to architect" is a `mailto:` link with a plain-text summary (budget lines
  with est. amounts + links, total, legal checklist) — opens the mail app, no backend.
