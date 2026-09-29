# GHAR Task Board — numbered tasks, owners, merge points

Legend: **DoD** = definition of done. Est = wall-clock estimate WITH the coding agent doing the typing.
Rule: if a task blows past 1.5× its estimate, cut it or downgrade it — do not push the schedule right.

---

## PHASE 0 — SETUP (12:00–12:15, both)

### T0 — Repo bootstrap — **Anupam** (10 min)
- Create public GitHub repo `ghar`. Push skeleton: `web/`, `server/`, `prompts/`, `demo/`, `docs/`,
  plus `AGENTS.md`, `PLAN.md`, `TASKBOARD.md`, `docs/CONTRACT.md`, `docs/PROMPTS.md`, `docs/DEMO_RUNBOOK.md`
  (copy from this plan pack).
- Fill Google credits form. Add `.env.example` (never commit real keys).
- **DoD:** Abhishek can clone and push; repo visible in incognito window.

### T1 — Keys + fixtures — **Abhishek** (10 min)
- API keys (event credits) working in `.env` on both laptops. `curl` one plain Gemini call to verify.
- Photograph the booth corner (the demo "room") from the exact demo angle → `demo/fixtures/corner.jpg`.
  Take 3 angles. This photo is the test fixture for EVERYTHING downstream.
- **DoD:** both machines make an authenticated API call; fixture photos committed.

---

## PHASE 1 — GATE (12:15–12:45)

### ✅ T2 — Live session spike — **Anupam** (30 min, HARD GATE)
- Clone Google's official Live API web console starter into `web/` (keep its LICENSE; note fork origin in README).
- Swap model to `gemini-3.1-flash-live-preview`. Run on laptop, then **open on phone over hotspot**:
  mic + camera streaming, model responds with voice.
- Agent prompt: paste the Live API docs URL + starter repo URL; instruction = "adapt, don't rewrite."
- **DoD:** you talk to it from the phone, it answers, camera frames are flowing. Nothing else.

### T3 — Image-model shootout + Omni validation — **Abhishek** (30 min)
- Script `server/scripts/validate.py`: (a) the SAME edit ("replace the chair with a rattan armchair,
  keep everything else identical") on `corner.jpg` through BOTH `gemini-3.1-flash-image` (NB2) and
  `gemini-3.1-flash-lite-image` (NB2 Lite). Docs say Lite is NOT optimized for editing — verify on
  our corner and pick the winner on room-identity first, latency second. Default expectation: NB2
  wins quality; Lite only if NB2 is too slow for the rail.
- (b) Fire ONE Omni Flash render from the best edited image ("golden hour light pass, camera
  locked") — note latency, confirm `previous_interaction_id` chains (do NOT set `store=false`).
- **DoD:** winner model ID announced at M1 and written into CONTRACT.md; an edited corner that
  still looks like our corner; one Omni render queued/returned. Record: latencies, quota errors.

### ✅ MERGE M1 (12:45) — both
GO/NO-GO (see PLAN.md). If GO: read docs/CONTRACT.md aloud together, adjust once, **lock it**.
Pull, tag `m1-gate`. From here you build against the contract, not against each other's code.

---

## PHASE 2 — PARALLEL BUILD (12:45–2:15)

### Anupam track (all in `web/`, sequential T4→T7)

### T4 — Designer persona + session context (30 min)
- Wire `prompts/persona.md` (v2 "Asha" in docs/PROMPTS.md §1) as the Live session system instruction.
- Append the SESSION CONTEXT block (docs/PROMPTS.md §1b): city from `navigator.geolocation`
  (fallback: ask the user), time-of-day/season from `Date`, the matching city block +
  static trend pack from docs/KNOWLEDGE.md. All client-side, assembled before connect.
  Keep injection under ~400 tokens.
- Test 2 min of conversation pointing the phone at the corner: warm, brief answers, city-aware
  ("since you're in Bangalore..."), narrates during tool calls per the three-beat wait protocol.
- **DoD:** persona holds character for 2 minutes; answers ≤ 2 sentences; mentions the city
  naturally once; never goes silent during a generate_variants call.

### T5 — Tool declaration + mock dispatch (30 min)
- Declare `generate_variants(description: string)`, `play_scene(scene: string)` and
  `compile_brief()` as Live API function declarations (see CONTRACT.md), and enable the
  `google_search` tool in the session (designer answers "what would that cost?" with grounded
  ₹ estimates — always framed as estimates). Client-side dispatcher: on tool call, log the event
  (this log feeds T7) and hit a MOCK endpoint returning 4 fixture image URLs; `compile_brief`
  shows the cached brief JSON (from T15 / fixtures).
- **DoD:** saying "I hate this chair, something lighter?" causes the model to CALL the tool
  unprompted, and 4 mock images appear via the rail's contract shape; a price question gets a
  grounded spoken answer.
- Escape hatch: if `google_search` + function declarations misbehave when combined in one live
  session, functions win — cut search; the designer gives persona-knowledge ₹ estimates instead.

### T6 — Speaks-first kickoff + barge-in + session ritual (25 min)
- On first camera frames, auto-send the kickoff turn (see PROMPTS.md) so the designer opens with an
  observation about the visible room. (The Live model has NO proactive audio — the kickoff turn IS
  the mechanism; do not fight the API for true proactivity.) Verify interruption: talk over it
  mid-sentence → it stops and pivots.
- **HARD LIMIT: audio+video sessions cap at 2 minutes.** Add a session timer + one-tap "reconnect"
  that restarts the session in <10s. The demo loop must fit in ~1:45; the restart is a rehearsed
  ritual ("let me call her back"), never a surprise.
- **DoD:** designer greets first with a scene-specific remark; barge-in works 3/3; reconnect
  ritual takes <10s and is muscle memory.

### T7 — Brain feed panel (30 min)
- Slim right-side ticker fed by the T5 event log: 👁 observations, 🔧 tool calls with args,
  🖼 image counts + latency, 📝 notes. Auto-scroll, monospace, quiet styling. SIDE PANEL, not a dashboard.
- **DoD:** during a live conversation, judges can watch tool calls fire in real time.

### Abhishek track (`server/` + `web/src/components/rail/`, T8→T11)

### T8 — /variants endpoint (40 min)
- FastAPI per CONTRACT.md: accepts `description` + `keyframe_b64`, fires **4 parallel** edit calls
  with the T3-winning image model (asyncio.gather), saves images to `server/static/`, returns URLs.
  Serve static files.
- Test with `corner.jpg` + 5 canned descriptions. Tune the edit-prompt wrapper (PROMPTS.md) so the
  room stays recognizable — single-object edits only.
- **DoD:** POST returns 4 URLs in < 15s total (adjust to T3's measured latency); ≥ 3 of 4 images
  keep the room identity.

### T9 — Rail component (30 min)
- `web/src/components/rail/` (your directory inside web/): horizontal strip, placeholder tiles appear
  the moment a tool call fires, fill as each image lands (poll or per-image fetch). Tap/click → enlarge.
- **DoD:** rail fills progressively against the mock, then against real T8 output; visible "streaming" feel.

### T10 — Omni pre-renders (20 min active, runs in background ALL afternoon)
- From T8's 3 best edited corners, start Omni Flash renders NOW:
  clip A "golden hour light pass", clip B via `previous_interaction_id` on A: "monsoon evening, rain
  on window, lamps on". Save to `demo/clips/`. Check every ~30 min; re-fire failures immediately.
- **DoD by 3:30 LATEST:** ≥ 2 good clips (evening + monsoon) of the SAME corner design, downloaded locally.

### T11 — Climax wiring (20 min)
- `play_scene(scene)` handler: maps `"evening"` / `"monsoon"` → local clips from T10, plays fullscreen
  in the video slot with a small honest caption: "generated with Omni Flash earlier this session".
- **DoD:** voice command "show me a Sunday evening here" plays clip A within 2 seconds.

### ✅ MERGE M2 (2:15) — both, PAIRED until it works
Swap T5's mock for the real T8 endpoint. Run the full loop on the real corner, phone in hand:
talk → self-initiated tool call → rail fills → "Sunday evening" → clip plays.
Debug the seam TOGETHER — this is the product; nothing else matters until it works.
Tag `m2-loop` when the loop runs clean twice in a row (target 3:00).

---

## PHASE 3 — MOATS (3:00–4:00)

### T12 — Persona tuning on the real corner — **Anupam** (40 min)
- Iterate `prompts/persona.md` against reality: does it proactively notice (window/light/clutter)?
  Does the vaastu line land naturally? Does it speak ₹? Does it stay brief?
- Build the "safe envelope": list 8–10 edit requests that reliably produce good variants; note the
  duds. The demo script only walks the safe envelope.
- **DoD:** 3 consecutive clean 90-second loops with proactive noticing in each.

### T13 — Language code-switch — **Anupam** (STRETCH, 30 min, cut instantly if flaky)
- Test: judge switches to Hindi/Kannada mid-conversation → designer follows
  (`gemini-3.5-live-translate-preview` or native multilingual in the live model — try native first).
- **DoD:** 3/3 clean switches, else CUT and never mention it.

### T15 — Brief Pack (budget + legal) — **Abhishek** (40 min, DO THIS BEFORE T14)
- `POST /brief`: takes the chosen variant description + object list → ONE structured Gemini call
  (text model + `google_search` grounding) returning JSON: itemized ₹ budget with cited vendor
  links (Pepperfry / Urban Ladder / IKEA India — links are grounded citations, prices are
  ESTIMATES, label them so) + society-NOC/legal checklist for the renovation scope (painting?
  no NOC · civil work? NOC + society form · electrical? licensed contractor cert).
- Simple Brief screen in the rail's directory: budget table + checklist + "Send to architect"
  (mailto: is fine). Pre-generate and CACHE the brief for the demo corner's best variant;
  the live call is the fallback, the cache is the demo.
- Why this outranks everything else in P3: India ₹ budgets + legal are two CONFIRMED market gaps
  no other team will touch, and it's one API call + one screen.
- **DoD:** "send this to my architect" (via `compile_brief` tool call) → brief screen with ≥5
  budget lines with links + ≥4 legal checklist items, in <3s (cached).

### T14 — Climax polish + mobile pass — **Abhishek** (30 min)
- Best 2 clips selected; transitions clean; phone layout: camera view dominant, rail bottom,
  brain feed collapsible. Kill any layout jank on the actual demo phone.
- **DoD:** entire loop looks intentional on the phone screen judges will hold.

### T15b — Preference notebook — **either** (STRETCH, 30 min, only if T14+T15 done early)
- `note_preference(fact)` tool + notebook list in the brain feed panel. Demo beat: "we have a
  toddler, budget fifty thousand" → notebook logs both → next variants visibly obey.
- **DoD:** the toddler/budget beat works 2/2, else CUT.

### ✅ MERGE M3 (4:00) — CODE FREEZE
Pull, run the loop once together, tag `demo-freeze`. After this tag, ONLY `README.md`, `demo/`,
and `docs/` may change. No exceptions — the winner is whoever stopped building first.

---

## PHASE 4 — REHEARSE + SUBMIT (4:00–5:00)

### T16 — Rehearsals — **both** (35 min)
- 3 full run-throughs in the booth corner on hotspot, phone in hand. Run #1 Anupam drives,
  #2 Abhishek drives (both must be able to solo it), #3 with a stranger as "judge" (recruit a neighbor).
- Screen-record the best run → `demo/fallback.mp4` AND upload (unlisted) for the README.
- **DoD:** both devs can run the loop solo; fallback video exists in two places.

### T19 — 3D splat gateway — **Abhishek** (PRE-EVENT ONLY; during event it's background, ~15 min of checks)
- **Decided TONIGHT, not at the event.** Pre-event: rent GPU (RTX 4090/A10G ~24GB), install
  VGGT → gsplat (fallback: Nerfstudio `ns-process-data` + `ns-train splatfacto`, COLMAP-based),
  reconstruct ONE room of your own house, view it in a Spark (three.js) page with WASD controls.
  If tonight's run is not clean end-to-end, the splat is CUT — no event hours go to it.
- If alive: at T1, capture the booth corner on video (walk a slow sideways arc, landscape, 60–80%
  overlap, NEVER pivot in place, ~1–2 min); upload to the GPU box; reconstruction runs in
  background (~5–40 min); check at M2 and at 4:00. Ships only if it looks good — it's a wow
  appendix ("walk the real room in 3D in the browser"), never a dependency of the loop.
- Honest framing for judges: splat = as-is reality in 3D (open-source pipeline, disclosed);
  the REDESIGN is 2D renders + Omni video. Generative furniture-swap inside a splat is not
  hackathon-feasible — say "roadmap" if asked.
- **DoD (pre-event):** one room of Abhishek's house walkable in a browser. **DoD (event):** booth
  corner splat loads on the demo phone, linked from the app as "Walk this room in 3D".

### T17 — README finalize — **Abhishek** (20 min)
- Pitch (3 sentences), architecture diagram (ASCII fine), models used with IDs, demo video link,
  **"Built during the event" vs "Starter code we adapted"** disclosure, team names.
- **DoD:** a judge skimming the README for 60 seconds understands product + what we built today.

### T18 — Submission — **Anupam** (by 4:45, not 5:00)
- Final push. Verify repo public in incognito. Submit the event form. Screenshot the confirmation.
- **DoD:** submitted 4:45; both devs have the repo URL and video link memorized for judging.

---

## Booth judging (5:00–6:45) → see docs/DEMO_RUNBOOK.md
Restart the Live session fresh for EVERY judge. Hand every judge the phone for the interruption beat.
