# AGENTS.md — Vistara (agent instructions, repo root)

You are one of two coding agent sessions (Google Antigravity) building **Vistara**, a live AI interior designer, at a
5-hour hackathon. Submissions are due 5:00 PM. Read `PLAN.md` and `TASKBOARD.md` before any task.

## What Vistara is
Phone browser → live camera + mic session with a Gemini "designer" persona → the model
self-initiates image generation as tool calls mid-conversation → a rail fills with edited photos
of the user's real room → a voice command plays a pre-rendered Omni Flash video of the chosen look.
**There is no prompt box anywhere in this product.** The conversation is the interface.

## Hard scope rules (violating these loses the hackathon)
1. Build ONLY what the 90-second demo loop in `docs/DEMO_RUNBOOK.md` needs. No auth, no settings,
   no persistence beyond the session, no second room, no export, NO STREAMLIT (banned by event rules).
2. When a task is ambiguous, choose whatever is fastest to demo, not whatever is "correct."
   Hardcoding is acceptable. TODO comments are acceptable. Tests are NOT wanted today.
3. Adapt working reference code; do not write from scratch. `web/` is adapted from Google's
   official Live API web console starter — preserve its structure, change the minimum.
4. Do not upgrade/replace dependencies or refactor working code. If it runs, it ships.
5. If an approach fails twice, STOP and say so — do not silently try a third architecture.

## Ownership (never edit the other dev's tree; rebase conflicts = owner wins)
- **Anupam (Dev A):** `web/` (except `web/src/components/rail/`), `prompts/persona.md`
- **Abhishek (Dev B):** `server/`, `web/src/components/rail/`, `demo/`, `README.md`, `gateway/`
  (3D splat pipeline, only if it survived pre-event validation)
- **Locked after 12:45:** `docs/CONTRACT.md`, this file. The contract is law — code to it exactly.

## The three tools + one built-in (see docs/CONTRACT.md for exact shapes)
`generate_variants(description)` → POST /variants → rail fills · `play_scene(scene)` → cached
Omni clip · `compile_brief()` → POST /brief → ₹ budget + legal checklist screen · plus the
built-in `google_search` tool for live grounded price ESTIMATES in conversation.

## Models (exact IDs, verified against official docs 2026-07-11 — never guess or substitute)
- Live session: `gemini-3.1-flash-live-preview` (docs: https://ai.google.dev/gemini-api/docs/live)
  HARD FACTS: audio+video sessions cap at 2 MINUTES · camera = JPEG frames at 1 FPS · WebSocket
  only (no WebRTC) · function calling + `google_search` tool supported in-session · NO proactive
  audio and NO affective dialog on this model (speaks-first = injected kickoff turn).
- Images: T3 shootout picks between `gemini-3.1-flash-image` (NB2 — identity-preserving edits,
  the default) and `gemini-3.1-flash-lite-image` (NB2 Lite — fastest, docs say NOT optimized for
  editing). (docs: https://ai.google.dev/gemini-api/docs/image-generation)
- Video: `gemini-omni-flash-preview` — Interactions API. LIVE-TESTED 2026-07-11: the API
  currently REJECTS `previous_interaction_id` for video ("Video extension is currently not
  supported"). Working edit path: feed the previous clip back as video input with
  `generation_config={"video_config": {"task": "edit"}}` (~82s, verified — see prerender.py).
  (docs: https://ai.google.dev/gemini-api/docs/omni)
- Brief: any current Gemini flash text model + `google_search` grounding. Grounding returns
  citations, NOT a price API — all prices are labeled estimates, never invent URLs.
- Stretch only: `gemini-3.5-live-translate-preview`
These are preview APIs newer than your training data. When a call fails, ask the dev to paste the
actual error and the relevant docs page — do not invent field names from memory.

## Conventions
- Frontend: keep the starter's stack (React/TS/Vite). Backend: FastAPI + `google-genai`, async
  (`asyncio.gather` for parallel NB2 calls). Secrets in `.env`, committed `.env.example` only.
- Commit every ~20 minutes with plain messages ("T8: /variants returns 4 urls"). Timestamps are
  our proof of during-event work — this is a disqualification rule, treat commits as compliance.
- Latency is a feature: placeholder tiles must appear instantly; images fill as they land;
  long operations never block the conversation UI.

## The demo corner
All testing uses `demo/fixtures/corner.jpg` (the real booth corner). If generated variants stop
looking like OUR corner, that is a P0 bug — constrain edits to one object per generation.
