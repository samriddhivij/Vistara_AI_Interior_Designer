# GHAR — Master Plan (Google DeepMind Bangalore Hackathon) — v2, post-research 2026-07-11

**Product:** Vistara — a live interior designer in your pocket. Camera-first, no prompt box.
Tour your room on a video call with an AI designer → it redesigns as you argue → one voice
command compiles a ₹-budget + vendor + legal brief for your architect.
**Track:** PS1 (Real-Time Multimodal Interaction, Live API). Depth evidence: PS3 (NB2 throughput) + PS4 (NB2→Omni chain).
**Team:** Anupam Rawat (Dev A — Live spine, `web/`), **Abhishek (Dev B — server/generation pipeline, rail, demo, README)**.
**Window:** 12:00 → 5:00 PM. Submissions 5:00 PM sharp. Booth judging 5:00–6:45. Finals 7:00–8:00.

## The one rule
Every decision from 12:00 to 5:00 is tested against one question:
**"Does this make the 90-second demo loop better?"** If no, it does not get built.

## Research-verified facts that changed the plan (2026-07-11, official docs)
1. **Live API sessions cap at 2 MINUTES with audio+video** (15 min audio-only). Camera input is
   JPEG frames at **1 FPS**, WebSocket only. → The demo loop must finish in ~1:45; the session-restart
   ritual is a rehearsed beat, not a failure. Persona is a thoughtful designer, not a play-by-play
   commentator (it sees 1 frame/sec).
2. **`gemini-3.1-flash-live-preview` does NOT support proactive audio / affective dialog** — our
   "speaks-first" is an injected kickoff turn (already the plan), and we do NOT attempt tone-reading.
3. **NB2 Lite (`gemini-3.1-flash-lite-image`) is explicitly NOT optimized for multi-turn editing.**
   For identity-preserving room edits the docs point to **NB2 = `gemini-3.1-flash-image`** (semantic
   inpainting: change one object, keep lighting/composition). T3 validates BOTH on the corner photo
   and picks the winner. Lite = speed story; Flash = quality story.
4. **Search grounding returns citations, not product prices.** Budget lines are "estimates with
   cited links", never promised SKU prices. Say "estimate" on stage.
5. **Live API supports the `google_search` tool + function calling in-session** → the designer can
   answer "what would that cost?" with grounded ₹ estimates LIVE. Cheap feature, big beat.
6. **Omni Flash confirmed:** `gemini-omni-flash-preview`, Interactions API, `previous_interaction_id`,
   ~$0.10/sec of 720p. `store=false` breaks later edit turns — don't set it.

## Market whitespace (verified 2026-07-11 — this is pitch ammunition, memorize)
- **Nobody accepts a video/live-camera house tour as input.** Entire market is single-photo
  (RoomGPT, Palazzo, REimagineHome) or LiDAR scans (IKEA Kreativ, Houzz Pro, CubiCasa).
- **Voice-first conversational redesign exists nowhere.** Text-chat only (Palazzo Vinci, Homestyler).
- **No open AI tool outputs an India ₹ budget with vendor links.** Livspace/HomeLane do it with
  humans in closed ecosystems; shoppable AI design is US-only.
- **Renovation legal/compliance (society NOC, municipal permission) has ZERO AI products in India.**
- Judges' one-liner: *"Four confirmed gaps — video input, voice redesign, India budgets, legal — and
  Vistara sits on all four."*

## The 90-second loop (what we are building, nothing else)
1. Camera opens → designer **speaks first**, commenting on something visible.
2. Judge **interrupts** mid-sentence → designer pivots instantly.
3. Conversation about the corner → model **self-initiates** `generate_variants` → rail fills with
   4 NB2 edits of the live corner. Brain feed shows the tool call firing. Judge asks "what would
   that lamp cost?" → designer answers with a grounded ₹ estimate.
4. Judge picks one by voice → "show me a Sunday evening here" → **cached Omni Flash clip** plays.
   "Now monsoon" → second cached clip.
5. **"Send this to my architect"** → `compile_brief` fires → Brief screen: itemized ₹ budget with
   cited vendor links + society-NOC/legal checklist (cached for the demo corner, honest caption).
6. Close: "No prompt box anywhere. Gemini is the event loop; NB2 and Omni are its hands."

## Two-layer architecture (say this when judges ask "what's the product beyond the demo?")
- **Live layer (built today):** Live API session per room — voice, proactive observations,
  interruptions, self-initiated tool calls (variants, scenes, brief, grounded prices).
- **Deep layer (roadmap + one artifact today):** the recorded tour → Gemini video understanding
  (1h context, timestamped Q&A, object bounding boxes) → whole-home inventory, multi-room-coherent
  design, floor-plan concept sketch ("illustrative, not to scale" — measurement-grade needs LiDAR),
  full architect export pack. Today's artifact from this layer = the Brief screen.
- **3D layer (optional wow, zero risk):** open-source Gaussian-splat gateway (video → VGGT/COLMAP →
  gsplat → Spark web viewer). Batch per room (~5–40 min on one GPU), NOT real-time. Runs in
  background during the event if pre-event setup succeeded; shown only if ready. Never gates anything.

## Timeline with merge points

| Clock | Phase | Anupam | Abhishek |
|---|---|---|---|
| 12:00–12:15 | **P0 Setup** | T0 repo + credits form | T1 keys + clone + fixtures (+ kick off splat capture/upload if T19 prepped) |
| 12:15–12:45 | **P1 Gate** | T2 Live session spike | T3 image-model shootout + Omni validation |
| **12:45** | **MERGE M1** | GO/NO-GO decision · lock docs/CONTRACT.md · tag `m1-gate` | |
| 12:45–2:15 | **P2 Parallel build** | T4–T7 (persona, tools+search, kickoff, brain feed) | T8–T11 (variants API, rail, Omni pre-renders, climax) |
| **2:15** | **MERGE M2** | Integration: real tool dispatch → /variants → rail. PAIR until loop works. Tag `m2-loop` (~3:00) | |
| 3:00–4:00 | **P3 Moats** | T12 persona tuning · T13 language switch (stretch) | T15 Brief Pack (budget+legal) · T14 climax wiring + mobile pass |
| **4:00** | **MERGE M3 — CODE FREEZE** | Tag `demo-freeze`. No code after this. | |
| 4:00–5:00 | **P4 Rehearse + submit** | T16 rehearse ×3 + record fallback · T18 submit by 4:45 | T16 rehearse · T17 README finalize (+ splat check: in or out) |

Lunch (1:00 PM): fetch, eat at desks. The lunch line is a 30-minute scope cut.

## PRE-EVENT (tonight — costs zero event hours)
- [ ] Both: API keys working, one Live session + one NB2 edit + one Omni render run by hand in AI Studio.
- [ ] Anupam: clone `google-gemini/live-api-web-console`, run it locally, swap model ID, confirm mic+cam.
- [ ] Abhishek: draft `/variants` + `/brief` skeletons against CONTRACT.md; test NB2 vs NB2-Lite edit
      on a photo of your own room.
- [ ] Abhishek (T19, OPTIONAL): rent GPU (RTX 4090/A10G, ~24GB), install VGGT→gsplat (fallback:
      Nerfstudio `ns-process-data` + `ns-train splatfacto`), reconstruct ONE room of your house
      end-to-end, view in Spark. If tonight's run isn't clean, splat is CUT for the event — decided
      tonight, not tomorrow.
- [ ] Both: read DEMO_RUNBOOK.md once, out loud, together.

## Git workflow (trunk-based, directory ownership — no PRs, no long branches)
- One public repo, both push **directly to `main`**.
- Conflict avoidance by ownership, not by process:
  - **Anupam owns:** `web/` (except `web/src/components/rail/`), `prompts/persona.md`
  - **Abhishek owns:** `server/`, `web/src/components/rail/`, `demo/`, `README.md`, `gateway/` (splat, if alive)
  - **Locked after M1 (edit only when paired):** `docs/CONTRACT.md`, `AGENTS.md`
- `git pull --rebase` before every push. Commit every ~20 min minimum — commit timestamps are our
  proof of "new work only" (disqualification rule).
- Merge points M1/M2/M3 are physical syncs: both stop, pull, run the loop together, tag.
- If a rebase conflicts: the directory owner wins, the other reverts their stray edit. 30 seconds, no debate.

## GO/NO-GO at M1 (12:45, no sentiment)
- **GO:** Live audio+camera session runs on the phone over hotspot → build Vistara.
- **NO-GO:** Live session not working after 30 min of honest effort → **pivot to Reroom**
  (photo upload → NB2 variant rail → one Omni conversational-edit video, submit PS3/PS4;
  Brief Pack survives as the differentiator). Abhishek's entire track (T8–T11, T15) survives the
  pivot unchanged; Anupam rebuilds `web/` as a simple upload UI (~1h with the coding agent).
  Decision is made once, at 12:45, never revisited.

## Compliance checklist (disqualification tripwires)
- [ ] Repo public from minute 0 (verify in incognito).
- [ ] README has "Built during the event" vs "Starter code we adapted" section
      (we adapt Google's official Live API web console — disclose it, link it; if splat ships,
      disclose the open-source pipeline and that reconstruction ran during the event on today's capture).
- [ ] No Streamlit. Brain feed stays a *side panel* (no dashboard-as-main-feature).
- [ ] Demo shows only today's work. Cached clips + cached brief = generated TODAY from TODAY's
      corner — say so, with the honest caption.
- [ ] Credits form filled at 12:00: https://forms.gle/7XRrpnJXQeXm4kk8A

## Model IDs (verified against official docs 2026-07-11 — do not let agents guess)
- Live session: `gemini-3.1-flash-live-preview` (2-min A/V cap · 1 FPS frames · WebSocket ·
  supports function calling + `google_search`; NO proactive audio / affective dialog)
- Images — T3 picks ONE: `gemini-3.1-flash-image` (NB2 — identity-preserving edits, default)
  vs `gemini-3.1-flash-lite-image` (NB2 Lite — fastest, NOT optimized for editing)
- Video: `gemini-omni-flash-preview` (Interactions API, `previous_interaction_id`, ~$0.10/s 720p,
  never set `store=false`)
- Brief/text: any current Gemini flash text model + `google_search` tool
- Stretch only: `gemini-3.5-live-translate-preview`
- Docs: https://ai.google.dev/gemini-api/docs/live · /docs/image-generation · /docs/omni ·
  /docs/google-search · /docs/interactions

## Connectivity
- **Coding:** venue wifi (`cv x gdm` / `hackathon`).
- **Demoing + rehearsing:** Anupam's phone hotspot, ALWAYS. Never demo on venue wifi.
- Splat gateway (if alive): cloud GPU box reachable from venue; uploads over venue wifi are fine
  (it's background batch work, not the demo path).
