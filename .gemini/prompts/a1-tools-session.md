You are Agent A1 for Dev A (Anupam). Execute T5 then T6 from TASKBOARD.md, in that order.

BEFORE CODING, read fully: TASKBOARD.md (T5+T6), docs/CONTRACT.md, docs/refs/live-api.md,
web/src/components/rail/INTEGRATION.md, prompts/persona.md (draft, read-only for you).

FILE SCOPE (hard rule): you may create/modify files ONLY inside web/, EXCLUDING
web/src/components/rail/**, web/src/components/brainfeed/**, and web/src/state/events.ts —
those belong to other agents. Never touch server/, demo/, docs/, prompts/, README.md.
NEVER run git commit or git push — the human integrates and commits.

## T5 — tool declarations + dispatcher
1. Session config tools array, exactly per docs/CONTRACT.md and docs/refs/live-api.md:
   [{ googleSearch: {} }, { functionDeclarations: [generate_variants, play_scene, compile_brief] }]
2. Create web/src/tools.ts — the dispatcher for turn.toolCall.functionCalls.
   ⚠ CRITICAL (docs/refs/live-api.md): this model has NO non-blocking function support.
   For EVERY tool call, session.sendToolResponse IMMEDIATELY (e.g. generate_variants →
   { result: "Generating 4 options now — they'll appear on the rail in a few seconds. Keep chatting." }),
   THEN do the real work async. Never make the model wait on HTTP.
3. Handlers:
   - generate_variants(description): grab the latest camera keyframe as base64 JPEG, POST
     { description, keyframe_b64 } to `${SERVER_URL}/variants`, then call
     startBatch(batch_id) imported from "./components/rail/Rail". While the rail's
     USE_MOCK=true, skip the fetch and call startBatch("mock-" + Date.now()).
   - play_scene(scene): play demo/clips/<scene>.mp4 ("evening" | "monsoon") fullscreen
     in a dismissible video overlay.
   - compile_brief(): wiring point 2 in INTEGRATION.md — show BriefScreen immediately,
     fill via mockFetchBrief() while USE_MOCK, real POST /brief after.
   - EVERY event (tool call fired, images landed, observation) → call
     logEvent(e) from "../state/events" (adjust relative path as needed).
     That module is being written IN PARALLEL by Agent A2. Code against exactly:
       export function logEvent(e: FeedEvent): void
       export function subscribe(cb: (events: FeedEvent[]) => void): () => void
     with FeedEvent from web/src/components/rail/types.ts. Do NOT create that file
     yourself; if it doesn't exist yet, keep the import and continue — it will land.
4. T5 DoD: saying "I hate this chair — something lighter?" makes the model call
   generate_variants UNPROMPTED; 4 mock tiles appear on the rail; a spoken price
   question gets a grounded spoken answer via googleSearch.

## T6 — kickoff + barge-in + the 2-minute ritual
1. When the first camera frames flow, auto-send the kickoff turn (prompts/persona.md §2)
   so the designer SPEAKS FIRST with an observation about the visible room.
2. Confirm barge-in/interruption works (talk over it → it stops and pivots).
3. Audio+video sessions HARD-CAP at 2 minutes: add a small on-screen countdown and a
   one-tap "Reconnect" that tears down and reopens the session (re-sending system
   instruction + tools) in <10 seconds.
4. T6 DoD per TASKBOARD.md.

FINISH by printing a report: files changed, exactly what the human must test by hand,
and any API errors verbatim. If an approach fails twice, STOP and say so.
