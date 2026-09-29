# REF: Gemini Omni Flash video (fetched from ai.google.dev 2026-07-11 — source: /gemini-api/docs/omni)
Source text © Google, CC-BY 4.0.

## Model
`gemini-omni-flash-preview` — video gen + conversational editing via the Interactions API.

## Image + text → video (T10 pre-renders)
```python
interaction = client.interactions.create(
    model="gemini-omni-flash-preview",
    input=[
        {"type": "image", "data": base64_image, "mime_type": "image/jpeg"},
        {"type": "text", "text": "golden hour light pass, camera locked"},
    ],
)
```

## Edit a previous video (Clip B = monsoon)
⚠ LIVE-TESTED 2026-07-11: `previous_interaction_id` is REJECTED for video ("Video extension is
currently not supported"). The docs' multi-turn story is ahead of the preview API. Working path —
feed the previous clip back as VIDEO INPUT:
```python
res2 = client.interactions.create(
    model="gemini-omni-flash-preview",
    input=[
        {"type": "video", "data": clip_a_b64, "mime_type": "video/mp4"},
        {"type": "text", "text": "same room, monsoon evening: rain on the window, lamps on"},
    ],
    generation_config={"video_config": {"task": "edit"}},
)
```
(~82s verified. Image edits still chain via `previous_interaction_id` fine — this is video-only.)

## Output
- SDK: `interaction.output_video.data` (base64 mp4).
- Large videos: request `response_format={"type": "video", "delivery": "uri"}` → poll
  `files.get(name)` until `state == "ACTIVE"`, then download. (Inline sync threshold ≈ 4 MB —
  our 10s/720p clips may exceed it; T10 should use URI delivery + polling by default.)

## Hard rules
- **NEVER set `store=false`** (docs-stated for edit chains; harmless to keep even on the
  video-input path).
- Video *references* longer than ~3s are not processed correctly; no multi-video reasoning.
- Generation time varies with load — pre-render early (T10 starts at ~1:00 PM), never live on stage.
- ~$0.10 per second of 720p output (≈ $1 per 10s clip).
