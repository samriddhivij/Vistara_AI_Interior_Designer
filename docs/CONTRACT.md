# CONTRACT.md — the seam between Anupam's web/ and Abhishek's server/
# LOCKED at MERGE M1 (12:45). After that, changes only when both devs are physically paired.

## Architecture (who calls what)

```
Phone browser (web/)
 ├─ Live API session (gemini-3.1-flash-live-preview)  ← Anupam
 │    mic + camera frames up, voice down, function calls emitted client-side
 ├─ Tool dispatcher (web/src/tools.ts)                ← Anupam
 │    on generate_variants → POST server /variants (with latest camera keyframe)
 │    on play_scene       → play local clip demo/clips/<scene>.mp4
 │    every event         → append to brain-feed store
 ├─ Rail component (web/src/components/rail/)         ← Abhishek
 └─ Brain feed panel                                  ← Anupam

FastAPI (server/)                                     ← Abhishek
 ├─ POST /variants  → 4 parallel image-edit calls (T3-winning model) → static URLs
 ├─ POST /brief     → 1 Gemini text call + google_search grounding → budget+legal JSON (cached for demo)
 ├─ GET  /static/*  → generated images
 └─ scripts/prerender.py → Omni Flash clips → demo/clips/   (run in background, NOT a live endpoint)
```

**Image model:** decided at T3 shootout, written here at M1. Default: `gemini-3.1-flash-image`
(NB2 — docs say Lite is NOT optimized for editing). If NB2 too slow for the rail, fall back to Lite.
**Live session constraint:** audio+video sessions cap at 2 minutes — web/ shows a timer and a
one-tap reconnect. Server must be stateless per-request so reconnects lose nothing.

## Function declarations (Live session tools) — exact shapes

```json
{
  "name": "generate_variants",
  "description": "Generate 4 redesign variants of what the camera currently sees. Call this whenever the conversation has produced a concrete design direction — do not ask permission, just call it.",
  "parameters": {
    "type": "object",
    "properties": {
      "description": {
        "type": "string",
        "description": "One-sentence design direction, e.g. 'replace the armchair with a rattan chair, warm neutral palette, keep everything else identical'"
      }
    },
    "required": ["description"]
  }
}
```

```json
{
  "name": "play_scene",
  "description": "Play a cinematic video of the currently selected design. Call when the user asks to see the room 'in the evening', 'at golden hour', 'in the monsoon', or 'living in it'.",
  "parameters": {
    "type": "object",
    "properties": {
      "scene": { "type": "string", "enum": ["evening", "monsoon"] }
    },
    "required": ["scene"]
  }
}
```

```json
{
  "name": "compile_brief",
  "description": "Compile the architect brief for the current design: itemized rupee budget with vendor links and the legal/society-approval checklist. Call when the user asks to 'send this to my architect', asks about total cost, or asks what approvals they need.",
  "parameters": { "type": "object", "properties": {}, "required": [] }
}
```

Also enabled in the Live session: the built-in `google_search` tool — the designer answers
"what would that cost?" questions live with grounded ₹ ESTIMATES (never promise exact prices;
grounding returns citations, not a price API).

## HTTP contract

### POST /variants
Request:
```json
{ "description": "string (from the tool call)", "keyframe_b64": "string (jpeg, current camera frame)" }
```
Response — **immediate** (< 500ms), before images exist:
```json
{ "batch_id": "b_123", "count": 4 }
```
### GET /variants/{batch_id}
Poll every 1s (rail does this):
```json
{ "batch_id": "b_123",
  "images": [
    { "slot": 0, "status": "done",    "url": "/static/b_123_0.jpg" },
    { "slot": 1, "status": "pending", "url": null },
    { "slot": 2, "status": "done",    "url": "/static/b_123_2.jpg" },
    { "slot": 3, "status": "failed",  "url": null }
  ] }
```
Rail renders 4 placeholder tiles the moment the tool call fires (from the brain-feed store event),
fills each tile as its slot goes `done`, quietly hides `failed` slots.

### POST /brief
Request:
```json
{ "description": "string (chosen variant's design direction)", "objects": ["armchair", "curtains", "..."] }
```
Response (cached for the demo corner — live call is the fallback):
```json
{ "budget": [
    { "item": "Rattan armchair", "estimate_inr": 12500, "source_url": "https://...", "note": "estimate" }
  ],
  "total_estimate_inr": 48000,
  "legal": [
    { "step": "Society NOC for civil work", "required": true, "detail": "Form + 2 weeks notice" }
  ] }
```
Brief screen (Abhishek's rail directory) renders budget table + legal checklist + "Send to architect".

## Brain-feed event store (client-side, web/src/state/events.ts) — Anupam owns, Abhishek reads
```ts
type FeedEvent =
  | { kind: "observation"; text: string; t: number }        // 👁 model noticed something
  | { kind: "tool_call"; name: string; args: object; t: number }  // 🔧 self-initiated call
  | { kind: "images"; batchId: string; done: number; ms: number; t: number } // 🖼
  | { kind: "note"; text: string; t: number };              // 📝 (stretch: preferences)
```

## Mock (Anupam uses until M2)
`web/src/tools.ts` has `USE_MOCK = true` → generate_variants resolves after 3s with
`demo/fixtures/mock_0..3.jpg`. Abhishek commits 4 real NB2 outputs of the corner as the mock
images by 1:15 so even the mock looks impressive. Flip `USE_MOCK = false` at M2.

## Env
```
GEMINI_API_KEY=            # both machines, from event credits
SERVER_URL=http://<anupam-laptop-LAN-ip>:8000   # phone must reach the server over hotspot LAN
```
NOTE: server runs on Anupam's laptop for the demo (phone + laptop on the same hotspot).
Abhishek develops on his machine, deploys by `git pull` on Anupam's at M2/M3.

---

## DIVERGENCE v2 (prompt-first + tour)

Three input modes now feed the same pipeline. This section is additive; everything above
still holds for the camera path. PRODUCT PRIORITY (inverted): prompt-first — imagine_space +
generate_tour is the primary experience; camera/upload is the FIX-IT side-feature (see
docs/MODES.md). The keyframe priority below is a dispatch mechanic only, not product priority.

### POST /variants — `keyframe_b64` is now OPTIONAL
```json
{ "description": "string (from the tool call)", "keyframe_b64": "string (jpeg) OR ABSENT" }
```
- `keyframe_b64` present → edit mode (unchanged): 4 parallel edits of the frame.
- `keyframe_b64` absent → **from-scratch mode**: server wraps the description in the
  FROM_SCRATCH_WRAPPER prompt (docs/PROMPTS.md §3b) and generates 4 concepts with no input
  image. Response and GET /variants/{batch_id} poll shapes are unchanged — the rail cannot
  tell the difference.

### Keyframe priority in web (tool dispatcher decides what to send)
1. Live video frame (camera on) — highest priority
2. Uploaded photo (FIX-IT button) — becomes the standing keyframe until camera resumes
3. None — send no `keyframe_b64`; server goes from-scratch

### POST /tour
Renders a cinematic Omni Flash walkthrough video of the currently selected concept image.
Request:
```json
{ "image_url": "/static/b_123_2.jpg (the chosen concept/variant)" }
```
Response — **immediate**, before the video exists:
```json
{ "job_id": "t_a1b2c3d4", "status": "pending" }
```
`job_id` format: `"t_"` + 8 hex chars.

### GET /tour/{job_id}
Poll every **3s** (video is slow — do not poll at 1s):
```json
{ "job_id": "t_a1b2c3d4", "status": "pending", "video_url": null }
```
```json
{ "job_id": "t_a1b2c3d4", "status": "done", "video_url": "/static/tour_a1b2c3d4.mp4" }
```
```json
{ "job_id": "t_a1b2c3d4", "status": "failed", "video_url": null }
```
- `status`: `pending | done | failed`. `video_url` is non-null ONLY when `done`.
- Expected latency: **40–120s** (Omni image→video measured ~38s, video-edit ~82s). The web
  UI must survive the full 2-minute Live-session window during a tour; persona covers the
  wait with the three-beat protocol.
- On `failed`: web surfaces nothing scary; persona retries once, then moves on.

### New function declarations (Live session tools) — exact shapes

```json
{
  "name": "imagine_space",
  "description": "Generate 4 from-scratch interior design concepts for a space the user has DESCRIBED in words (no camera view needed). Call this when the user describes a room they want designed — an empty flat, a dream reading corner, an imagined cafe — after at most one clarifying question. Do not ask permission, just call it.",
  "parameters": {
    "type": "object",
    "properties": {
      "description": {
        "type": "string",
        "description": "One rich sentence describing the space and direction, e.g. 'a compact north-lit reading room in a Bangalore 2BHK, warm minimal, cane armchair, wall of open shelves, budget-friendly'"
      }
    },
    "required": ["description"]
  }
}
```

```json
{
  "name": "generate_tour",
  "description": "Render a cinematic video walkthrough of the currently selected design concept. Call when the user picks a concept or asks to 'walk through it', 'tour it', or 'see it in motion'. Takes a minute or two — keep talking while it renders.",
  "parameters": { "type": "object", "properties": {}, "required": [] }
}
```
Web dispatcher: `imagine_space` → POST /variants with NO `keyframe_b64`;
`generate_tour` → POST /tour with the selected rail tile's image URL, then poll at 3s and
play the mp4 full-bleed when `done`.
