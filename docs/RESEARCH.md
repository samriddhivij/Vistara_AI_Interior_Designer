# RESEARCH.md — verified findings behind PLAN v2 (three research sweeps, 2026-07-11)

Read this once. Everything here was fetched from official docs / primary sources today.

## 1. Gemini API ground truth (ai.google.dev, fetched today)
- **Live API** (`gemini-3.1-flash-live-preview`, preview): audio in/out + JPEG frames @ **1 FPS**,
  **2-min cap on audio+video sessions** (15 min audio-only), WebSocket only, ephemeral tokens for
  browser prod. Function calling + `google_search` in-session: YES. Proactive audio / affective
  dialog: NO on 3.1 (that's the 2.5 native-audio model). Barge-in/VAD: yes, tunable.
  Starter repo `google-gemini/live-api-web-console` is real but references an old model ID — swap it.
- **Images**: NB2 Lite (`gemini-3.1-flash-lite-image`) is fastest (~$0.034/img) but docs say
  **NOT optimized for multi-turn editing**. NB2 (`gemini-3.1-flash-image`) does documented
  semantic inpainting — change one object, keep lighting/composition. Imagen 4 deprecated.
- **Video**: Omni Flash (`gemini-omni-flash-preview`) = conversational video gen/edit via
  Interactions API, `previous_interaction_id`, ~$0.10/s 720p, `store=false` breaks edit chains.
  Veo 3.1 = cinematic clips 4/6/8s, extension to ~148s, 11s–6min latency. Veo 3.0 is GONE.
- **Video understanding**: 1 FPS sampling, up to 1h video in 1M context, timestamped Q&A,
  2D bounding boxes + segmentation. This is the "deep layer" / roadmap engine.
- **Search grounding**: citations + links, **no product-price API**. 5k prompts/mo free on
  Gemini 3, then $14/1k queries. All prices we show are labeled estimates.

## 2. Market landscape (20+ product pages fetched)
- **No product accepts video-tour input.** All photo-based (RoomGPT, Palazzo, REimagineHome,
  Spacely) or scan-based (IKEA Kreativ multi-photo, Houzz Pro LiDAR, CubiCasa walkthrough→floor
  plan only, no design).
- **No voice-first design tool exists.** Text chat only (Palazzo "Vinci", Homestyler agent).
- **India ₹ budgets + vendor links via AI: doesn't exist.** Livspace (2BHK from ₹4.52L) and
  HomeLane do budgets with human designers in closed supply chains. Shoppable-AI tools
  (REimagineHome, Palazzo, Wayfair Muse) are US-catalog only.
- **Legal/NOC layer: zero AI products in India.** ADDA digitizes society approval inboxes;
  PermitFlow ($54M Series B) proves the category in the US, B2B only.
- Structural advantage worth pitching: photo tools are one-room-one-shot; a video tour naturally
  enables whole-home coherence (one design language, one budget) — nobody can follow us there
  without changing their input modality.

## 3. 3D feasibility (papers + repos fetched)
- **True 3D on Google APIs alone: impossible** — no splatting/NeRF/photogrammetry endpoint exists.
- **Cinematic illusion on Google APIs: works** — NB2 still → Veo/Omni image-to-video with prompted
  dolly/orbit. DeepMind's own paper (arXiv 2509.20328) lists novel-view synthesis as a Veo
  zero-shot capability. Prompt-steered camera, not parametric — expect drift on full orbits.
- **Open-source gateway (T19): batch-per-room, never real-time.** Recommended: VGGT
  (facebookresearch/vggt, CVPR'25 best paper) for poses in seconds → gsplat training 5–15 min on a
  4090-class GPU → view in Spark (sparkjsdev/spark, MIT, three.js) with WASD controls.
  Classic fallback: Nerfstudio `ns-process-data video` (COLMAP, 10–40 min) + `ns-train splatfacto`.
  Zero-code viewer fallback: drag .ply into superspl.at → publish static viewer.
  Capture rules: slow sideways arcs, landscape, 60–80% overlap, NEVER pivot in place, lock
  exposure, avoid mirrors, 1–2 min per room, ~100–300 frames.
  Streaming/live reconstruction = research-grade (MonoGS ~10fps on 4090, RGB-D-only for the fast
  ones) — do not attempt.
- **Generative furniture-swap inside a splat: not hackathon-ready.** GaussianEditor is a day of
  env-fighting; Instruct-GS2GS is scene-wide style only. Splat = as-is reality; redesign = 2D + video.
  (Deleting objects from a splat in SuperSplat's editor IS easy — roadmap material.)
- **Floor plans from video: concept sketch only.** VSI-Bench (CVPR'25): VLMs build local, not
  global, spatial maps; humans beat best model by 33 pts; models near-human on room-size estimates.
  Measurement-grade needs LiDAR/IMU (Apple RoomPlan, CubiCasa use sensor pose data). If we ever
  ship plans: Gemini → SVG schematic labeled "illustrative, not to scale".

## What this changed in the plan (delta from v1)
1. 2-min session cap → loop timed to 1:45 + rehearsed reconnect ritual (T6).
2. T3 is now a NB2 vs NB2-Lite shootout (Lite's editing weakness is documented).
3. New T15 **Brief Pack** (₹ budget + legal checklist, one grounded call) — replaces notebook as
   the #1 P3 priority because it lands on two confirmed market gaps. Notebook demoted to T15b.
4. New `compile_brief()` tool + `google_search` enabled in the Live session (live price estimates).
5. New T19 splat gateway — pre-event go/no-go, event-time background only, appendix in the demo.
6. Pitch upgraded with the four-whitespace line; roadmap line now cites video understanding
   (1h tours) as the deep layer.
