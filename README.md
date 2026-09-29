# Vistara — a live AI interior designer in your pocket

Redesigning a room today means typing prompts at a photo. Vistara deletes the prompt box: you walk
your room on a video call with a designer who sees what you see, interrupts and gets interrupted,
and redesigns the room at the speed of the argument. One Live API session drives Nano Banana and
Omni Flash as its hands — the conversation is the interface.

**Demo video:** <!-- TODO by 4:40 — unlisted upload link of the best rehearsal run -->

**Track:** PS1 (Real-Time Multimodal Interaction, Live API), with depth evidence for PS3 (NB2
throughput) and PS4 (NB2 → Omni chain).

## Architecture

```
Phone browser (web/)
 ├─ Live API session (gemini-3.1-flash-live-preview)
 │    mic + camera frames up, voice down, function calls emitted client-side
 ├─ Tool dispatcher (web/src/tools.ts)
 │    on generate_variants → POST server /variants (with latest camera keyframe)
 │    on play_scene       → play local clip demo/clips/<scene>.mp4
 │    every event         → append to brain-feed store
 ├─ Rail component (web/src/components/rail/)
 └─ Brain feed panel

FastAPI (server/)
 ├─ POST /variants  → 4 parallel image-edit calls → static URLs
 ├─ POST /brief     → 1 Gemini text call + google_search grounding → budget+legal JSON
 ├─ GET  /static/*  → generated images
 └─ scripts/prerender.py → Omni Flash clips → demo/clips/  (background, not a live endpoint)
```

## Models used (exact IDs)

| Role | Model |
|---|---|
| Live voice + camera session | `gemini-3.1-flash-live-preview` |
| Image edits (variant rail) | `gemini-3.1-flash-image` (NB2) <!-- TODO by 4:40: confirm T3 shootout winner; alt was gemini-3.1-flash-lite-image --> |
| Video scenes (evening/monsoon) | `gemini-omni-flash-preview` (Interactions API, `previous_interaction_id` edit chain) |
| Architect brief | Gemini flash text model + `google_search` grounding <!-- TODO by 4:40: exact text model ID used in server/app.py --> |

No prompt box anywhere. The Live session self-initiates `generate_variants`, `play_scene` and
`compile_brief` as function calls mid-conversation; prices quoted in-session are grounded
`google_search` ESTIMATES with citations, never invented.

## Built during the event vs. starter code we adapted

**Starter code we adapted (disclosed):**
- `web/` is adapted from Google's official
  [live-api-web-console](https://github.com/google-gemini/live-api-web-console) starter
  (Apache-2.0, LICENSE preserved). We swapped the model ID, wired our persona/system instruction,
  tool declarations, dispatcher, and layout — the streaming scaffolding is theirs.

**Built during the event (today, 2026-07-11 — see commit timestamps):**
- Everything in `server/` — FastAPI `/variants` + `/brief`, the Omni pre-render script.
- `web/src/components/rail/` — the progressive variant rail and brief screen.
- `prompts/` — designer persona, kickoff turn, edit wrappers.
- `demo/` — fixtures shot at the booth today, clips rendered today from today's corner.
- All video clips in the demo were generated with Omni Flash **during the event** from the booth
  corner photographed at 12:00 today; the brief for the demo corner is cached from a grounded
  call made today. We say so on stage.

<!-- TODO by 4:40: if the T19 3D splat gateway shipped, disclose the open-source pipeline
     (VGGT/Nerfstudio + gsplat + Spark viewer) and that reconstruction ran during the event
     on today's booth capture. Delete this comment if splat was cut. -->

## Run it

```bash
# 1. env (both server and web read the repo-root .env — see .env.example)
cp .env.example .env
#   GEMINI_API_KEY=<your key>
#   SERVER_URL=http://<laptop-LAN-ip>:8000   # phone must reach the server over the hotspot LAN

# 2. server
cd server
pip install -r requirements.txt   # fastapi, uvicorn, google-genai
uvicorn app:app --host 0.0.0.0 --port 8000

# 3. web
cd web
npm install
npm run dev                        # open the LAN URL on the phone, same hotspot

# 4. (background, once) pre-render the demo clips from the best edited corner image
python server/scripts/prerender.py server/static/<best_edit>.jpg
```

<!-- TODO by 4:40: verify the exact install/run commands above against what actually shipped -->

## Team

- **Anupam Rawat** (Dev A) — Live session spine, persona, tools + brain feed (`web/`)
- **Abhishek** (Dev B) — generation pipeline, rail, brief pack, demo assets (`server/`, `web/src/components/rail/`, `demo/`)
