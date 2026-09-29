# ABHI-DELTA.md — Abhishek-side changes since your review (2026-07-11, afternoon)
# Audience: Anupam's coding agent session. Everything below is on top of the state you reviewed
# (the zip / abhishek_changes you merged). Pick up from "WHAT'S LEFT TO TEST" at the bottom.

## TL;DR
1. Your one open flag — `generate_content` vs `interactions.create` — is RESOLVED: both
   surfaces live-tested and working. No change needed in `app.py`. Close the VERIFY.
2. One REAL API-vs-docs discrepancy found and fixed live: `previous_interaction_id` is
   REJECTED for video. `prerender.py` now uses the verified video-input edit path.
3. Both demo clips (`evening.mp4`, `monsoon.mp4`) exist on disk, generated live today
   end-to-end (from a synthetic fixture — regenerate from the real corner at the event).
4. Persona/prompts fully rebuilt from two research sweeps (voice-UX + Indian-architect
   constraints). New file `docs/KNOWLEDGE.md`; `docs/PROMPTS.md` is v2; T4 spec updated.
5. T19 (3D splat gateway) is built in `gateway/` — pre-event go/no-go tonight, event-time
   background only. Does not touch the demo loop.

---

## 1. Live validation results (real API key, real calls — all zero quota errors)

| Call | Surface | Result | Latency |
|---|---|---|---|
| NB2 `gemini-3.1-flash-image` edit | Interactions API | OK | 12.7s |
| NB2 Lite `gemini-3.1-flash-lite-image` edit | Interactions API | OK | 6.6s |
| Same edit via `app.py`'s `_edit_image_sync` | generate_content | OK, 583KB image | 10.2s |
| Omni Clip A (image→video) | Interactions API | OK, 2.5MB mp4 | 37.8s |
| Omni Clip B (monsoon) via `previous_interaction_id` | Interactions API | **400 REJECTED** | — |
| Omni Clip B via video-input + task=edit | Interactions API | OK, 2.7MB mp4 | 82.1s |

Notes for your side:
- **Your VERIFY on `_edit_image_sync` is closed** — `types.Part.from_bytes` works against
  the live API. Both API surfaces are valid front doors; we keep app.py on generate_content
  and the scripts on Interactions. No standardization needed at M1.
- **Model quality finding** (synthetic cartoon-style fixture): NB2 preserved the input's
  style faithfully; NB2 Lite "beautified" it into photorealism — i.e. Lite drifts room
  identity exactly as the docs warned. Default pick stays **NB2** (`gemini-3.1-flash-image`).
  Re-eyeball on the real corner photo at T3 tomorrow.
- **Latency planning numbers:** image edit ~10–13s ⇒ rail fills over ~13s with 4 parallel
  calls (progressive fill design is right). Omni ~38s (image→video) / ~82s (video edit) ⇒
  clips MUST stay pre-rendered, as planned.
- Key model check: `gemini-2.5-flash` 404s on this key ("no longer available to new
  users") — anywhere old model IDs linger (the Live starter's default!) must be swapped.

## 2. Code changes since your review

### `server/scripts/prerender.py` — MONSOON PATH REWRITTEN (the one real fix)
- Old (docs-derived): Clip B chained via `previous_interaction_id` on Clip A.
- Live reality: API returns 400 — "Video extension is currently not supported" and
  "previous_interaction_id is not allowed when video task is set". Docs are ahead of the
  preview API.
- New (live-verified): Clip B feeds Clip A's mp4 back as VIDEO INPUT:
  ```python
  client.interactions.create(
      model="gemini-omni-flash-preview",
      input=[{"type": "video", "data": <clip_a_b64>, "mime_type": "video/mp4"},
             {"type": "text", "text": PROMPT_MONSOON}],
      generation_config={"video_config": {"task": "edit"}},
  )
  ```
- `interactions.json` record now stores `edited_from` instead of `previous_interaction_id`.
- The finding is documented in the code docstring AND in `AGENTS.md` (model section) so no
  agent re-fights it.
- **Demo beat unchanged for you:** "now monsoon" still maps to a cached clip; only how the
  clip was produced changed.

### `web/src/components/rail/types.ts` + `BriefScreen.tsx` — null-link fix (small)
- Contract allows `source_url: null` (never invent URLs). Types now say `string | null`;
  BriefScreen hides the vendor link and omits it from the mailto body when null.
  (You may already have this if you merged after my review pass — check `types.ts` line ~28.)

### `demo/` — artifacts now present (generated live today, synthetic fixture)
- `demo/clips/evening.mp4` (2.6MB) and `demo/clips/monsoon.mp4` (2.7MB) — named per the
  `play_scene` contract; T11 can wire and test against them NOW.
- `demo/fixtures/corner.jpg` — SYNTHETIC stand-in (flat cartoon room). Replace with the real
  booth photo at T1 and re-run validate.py + prerender.py.
- `demo/fixtures/edit_nb2.jpg`, `edit_nb2lite.jpg`, `edit_via_appjs_surface.jpg` — shootout
  outputs for eyeballing. `omni_interaction_id.txt`, `demo/clips/interactions.json` — run records.

### Local env (not in git material): `.venv/` with google-genai 2.11.0 works; `.env` has the
event key (gitignored on your side — keep it that way; key is chat-exposed, rotate post-event).

## 3. Prompt system v2 (research-backed — affects YOUR T4/T6/T12)

Two research sweeps were run (voice-UX best practices: Sesame/Vapi/Retell/Hume/NN-g; and
Indian-architect constraints: climate/materials/vaastu/dimensions/budgets/trends). Synthesized into:

### NEW `docs/KNOWLEDGE.md`
City-by-city material rules (Bangalore/Mumbai/Delhi/hot-dry), orientation rules, 8 opt-in
vaastu rules, renter-vs-owner constraints, dimension/clearance numbers, metro budget bands,
2025-26 trend pack (Asian Paints CoTY 2026 "Moonlit Silk", Japandi, cane, terracotta...).
The server/web injects the RELEVANT slice per session; the persona itself stays lean.

### `docs/PROMPTS.md` — v2 (persona rewritten)
- Persona is now "Asha, twelve years in Indian homes". Key additions your T4 must wire:
  - 2-sentence cap, one question per turn, spoken-words-only (no digits/lists).
  - Backchanneling ("mm-hmm") while the user pans; interruption = never restart the sentence.
  - Tone mirroring; Hinglish/Kannada mirror-turn-by-turn, never switch first.
  - **Three-beat wait protocol** for generate_variants (never silent during the ~13s):
    instant commit → narrate the actual design decisions → bridge question → guided reveal.
  - Vaastu is OPT-IN ("keep Vaastu in mind, or skip it?"), renter question when relevant,
    compliment-before-critique with spoken ₹ ranges.
- **NEW §1b: SESSION CONTEXT injection** — client-side, assembled BEFORE connect:
  city (`navigator.geolocation` → reverse geocode, fallback: ask), time-of-day/season
  (`Date`), `navigator.language` as soft prior, the matching city block + trend pack from
  KNOWLEDGE.md. Budget: keep under ~400 tokens. This is YOUR wiring (T4) — implementation
  notes are in PROMPTS.md §1b.
- Kickoff prompt (§2) updated: may fold in ONE city/time fact, two sentences total.

### `TASKBOARD.md` — T4 updated (now 30 min): persona v2 + session-context injection;
new DoD includes "mentions the city naturally once; never goes silent during generation".

## 4. NEW `gateway/` — T19 3D splat pipeline (Abhishek-owned, does NOT touch the loop)
- `setup.sh` (GPU box bootstrap: VGGT + gsplat/nerfstudio + COLMAP fallback),
  `reconstruct.py` (video → frames → poses → splat → scene.ply; resumable; --fast ≈5–8min),
  `server.py` (upload/status/serve; import-tested), `viewer/index.html` (Spark + three.js,
  orbit + WASD walk), `README_GATEWAY.md` (tonight's go/no-go runbook).
- Decision rule stands: clean end-to-end run TONIGHT on a rented 4090 or the splat is CUT.
  At the event it's background-only and a demo appendix, never a dependency.
- Unverified-on-GPU items are tagged `# VERIFY on GPU box` in source; likeliest tweak is one
  nerfstudio dataparser flag (noted in the README).

---

## WHAT'S DONE (tested) vs WHAT'S LEFT TO TEST

### Done and live-verified today
- [x] Image edit, both models, both API surfaces (latencies above)
- [x] Omni image→video (Clip A) and video-edit (Clip B monsoon) — clips on disk
- [x] API key valid; `gemini-3.5-flash` OK; `gemini-2.5-flash` dead on this key
- [x] server/app.py smoke-tested (TestClient): /variants immediate return, poll shape, /brief cache ladder
- [x] Rail: strict tsc clean + mock lifecycle runtime-tested; brief null-link path fixed
- [x] prerender.py end-to-end (with the rewritten monsoon path)

### Left to test — YOUR SIDE (Anupam / Anupam's agent)
- [ ] Live API session: mic+camera on phone over hotspot, model `gemini-3.1-flash-live-preview`
      (remember: starter repo defaults to a dead model ID — swap it first thing)
- [ ] Function calling from the Live session → your dispatcher → POST /variants → `startBatch()`
      (rail is mock-ready; flip `USE_MOCK=false` at M2). Remember: `sendToolResponse` FIRST,
      then `startBatch` — per your live-api notes.
- [ ] `google_search` tool enabled in the Live session (live ₹ estimate answers)
- [ ] Persona v2 + session-context injection (T4): does Asha hold voice rules? city mention?
      three-beat narration during tool calls?
- [ ] Kickoff turn (T6): speaks-first with a scene observation; barge-in 3/3; 2-min session
      timer + <10s reconnect ritual
- [ ] `compile_brief` tool → BriefScreen with the cached brief (rename
      `server/static/brief_cache_example.json` → `brief_cache.json` to arm it)

### Left to test — ABHISHEK SIDE
- [ ] validate.py + prerender.py re-run on a REAL room photo (identity-preservation eyeball)
- [ ] /variants under 4-parallel load with real keyframes from the phone (only smoke-tested
      with TestClient so far — not yet hit with real base64 camera frames)
- [ ] Gateway go/no-go on the GPU box (tonight; see gateway/README_GATEWAY.md)
- [ ] prerender.py's `interactions.get` polling kwarg — untested because create() returned
      completed inline in our runs (likely blocks; poll loop may be dead code, fine either way)

### Joint at M2 (2:15)
- [ ] Full loop on the real corner: talk → self-initiated tool call → rail fills → "Sunday
      evening" → clip plays → "send to my architect" → brief screen
- [ ] Latency feel-check: does the three-beat narration cover the ~13s rail fill?

## File inventory of this delta (for your merge)
```
modified: server/scripts/prerender.py        (monsoon path rewrite — the real fix)
modified: web/src/components/rail/types.ts    (source_url nullable)
modified: web/src/components/rail/BriefScreen.tsx (null link handling)
modified: docs/PROMPTS.md                     (persona v2 + §1b session context)
modified: TASKBOARD.md                        (T4 respec'd)
modified: AGENTS.md                           (Omni live-tested facts in model section)
new:      docs/KNOWLEDGE.md                   (designer knowledge pack)
new:      docs/ABHI-DELTA.md                       (this file)
new:      gateway/                            (T19: setup.sh, reconstruct.py, server.py,
                                               viewer/index.html, README_GATEWAY.md)
new:      demo/clips/evening.mp4, monsoon.mp4, interactions.json
new:      demo/fixtures/corner.jpg (SYNTHETIC — replace at T1) + edit outputs + omni id
```
Do NOT merge: `.venv/`, `.env` (key), `__pycache__`. Canonical docs remain on your main —
this delta only ADDS docs/KNOWLEDGE.md + docs/DELTA.md and modifies the files listed above.
