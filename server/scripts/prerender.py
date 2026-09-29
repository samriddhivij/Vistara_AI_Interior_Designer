#!/usr/bin/env python3
"""
T10 — Omni Flash pre-renders (Vistara).

Usage:
    python prerender.py <edited_image.jpg>              # fire Clip A (evening) then Clip B (monsoon)
    python prerender.py <edited_image.jpg> --only evening
    python prerender.py <edited_image.jpg> --only monsoon   # chains off Clip A's id in interactions.json

Fires two Omni Flash (`gemini-omni-flash-preview`) renders via the Interactions API:
  Clip A "golden hour"  -> demo/clips/evening.mp4    (image-to-video from the edited corner)
  Clip B "monsoon"      -> demo/clips/monsoon.mp4    (EDIT chained via previous_interaction_id on A)
Interaction ids are saved to demo/clips/interactions.json so a failed Clip B can be
re-fired later with --only monsoon without re-rendering Clip A.

NEVER set store=false — it breaks previous_interaction_id edit chains (per official docs).

Call shapes verified against https://ai.google.dev/gemini-api/docs/omni and
https://ai.google.dev/api/interactions-api (fetched 2026-07-11):
  - client.interactions.create(model=..., input=[{"type":"image","data":b64,"mime_type":"image/jpeg"},
                                                 {"type":"text","text":...}])
  - chained edit: client.interactions.create(model=..., previous_interaction_id=prev.id, input=prompt)
  - status enum: in_progress | requires_action | completed | failed | cancelled | incomplete | budget_exceeded
  - video: interaction.output_video.data (base64) or .uri (download via client.files.download)

This is a background CLI script, NOT a live endpoint. Do not import from server/app.py.
"""

import argparse
import base64
import json
import os
import sys
import time
import traceback
from pathlib import Path

from google import genai

MODEL = "gemini-omni-flash-preview"

REPO_ROOT = Path(__file__).resolve().parents[2]
CLIPS_DIR = REPO_ROOT / "demo" / "clips"
INTERACTIONS_JSON = CLIPS_DIR / "interactions.json"

# Prompts — verbatim from docs/PROMPTS.md section 4. Do not tune here; tune there first.
PROMPT_EVENING = (
    "Animate this room. A slow golden-hour pass: warm evening sunlight slides across the floor and "
    "walls, shadows lengthen naturally, curtains breathe gently in a light breeze. Camera locked, "
    "no cuts, photorealistic, calm."
)
PROMPT_MONSOON = (
    "Same room, same furniture, but now a monsoon evening: rain streaking the window, cool grey "
    "daylight outside, warm lamps glowing inside, subtle reflections on the floor near the window. "
    "Camera locked, no cuts."
)

POLL_INTERVAL_S = 10
POLL_TIMEOUT_S = 15 * 60  # Omni renders can take minutes; give up after 15.


def load_api_key() -> str:
    """GEMINI_API_KEY from env, else repo-root .env (same pattern as the rest of server/)."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        env_file = REPO_ROOT / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line.startswith("GEMINI_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not key:
        sys.exit("FATAL: GEMINI_API_KEY not set (env or .env at repo root). See .env.example.")
    return key


def wait_until_done(client: genai.Client, interaction, label: str):
    """Poll a background/long-running interaction until it leaves in_progress.

    Docs (interactions-api): status enum has in_progress / requires_action / completed /
    failed / cancelled / incomplete / budget_exceeded. create() may already return a
    completed interaction with output_video inline — then we never poll.
    """
    start = time.time()
    while True:
        status = getattr(interaction, "status", None)
        has_video = getattr(interaction, "output_video", None) is not None
        if status == "completed" or (status is None and has_video):
            return interaction
        if status in ("failed", "cancelled", "incomplete", "budget_exceeded", "requires_action"):
            raise RuntimeError(f"{label}: interaction {interaction.id} ended with status={status!r}")
        elapsed = time.time() - start
        if elapsed > POLL_TIMEOUT_S:
            raise TimeoutError(f"{label}: still {status!r} after {elapsed:.0f}s (id={interaction.id})")
        print(f"  [{label}] status={status!r} — polling again in {POLL_INTERVAL_S}s ({elapsed:.0f}s elapsed)")
        time.sleep(POLL_INTERVAL_S)
        # VERIFY AGAINST DOCS: REST is GET /v1beta/interactions/{id}; python-genai SDK
        # exposes it as client.interactions.get(...) — kwarg name unconfirmed on the docs
        # page (external SDK ref). Try positional id first, fall back to id=.
        try:
            interaction = client.interactions.get(interaction.id)
        except TypeError:
            interaction = client.interactions.get(id=interaction.id)


def save_video(client: genai.Client, interaction, out_path: Path, label: str):
    """Write interaction.output_video to disk. Handles inline base64 and uri delivery."""
    video = getattr(interaction, "output_video", None)
    if video is None:
        raise RuntimeError(f"{label}: interaction {interaction.id} completed but has no output_video")

    data = getattr(video, "data", None)
    if data:
        # Docs example: f.write(base64.b64decode(interaction.output_video.data))
        video_bytes = base64.b64decode(data) if isinstance(data, str) else data
    elif getattr(video, "uri", None):
        # >4MB videos come back as a Files API uri (docs: client.files.download(file=video_output.uri))
        file_name = video.uri.split("/")[-1]
        while True:
            f_info = client.files.get(name=f"files/{file_name}")
            state = getattr(f_info.state, "name", f_info.state)
            if state == "ACTIVE":
                break
            if state == "FAILED":
                raise RuntimeError(f"{label}: file {video.uri} state=FAILED")
            print(f"  [{label}] video file state={state} — waiting 5s")
            time.sleep(5)
        video_bytes = client.files.download(file=video.uri)
    else:
        raise RuntimeError(f"{label}: output_video has neither data nor uri")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(video_bytes)
    print(f"  [{label}] saved {out_path} ({len(video_bytes) / 1e6:.1f} MB)")


def load_record() -> dict:
    if INTERACTIONS_JSON.exists():
        try:
            return json.loads(INTERACTIONS_JSON.read_text())
        except json.JSONDecodeError:
            print(f"WARN: {INTERACTIONS_JSON} is corrupt, starting fresh")
    return {}


def save_record(record: dict):
    INTERACTIONS_JSON.parent.mkdir(parents=True, exist_ok=True)
    INTERACTIONS_JSON.write_text(json.dumps(record, indent=2))
    print(f"  interaction ids -> {INTERACTIONS_JSON}")


def render_evening(client: genai.Client, image_path: Path, record: dict) -> bool:
    """Clip A: image-to-video golden hour. Returns True on success."""
    label = "evening"
    print(f"\n=== Clip A ({label}): golden hour from {image_path.name} ===")
    try:
        image_b64 = base64.b64encode(image_path.read_bytes()).decode("utf-8")
        t0 = time.time()
        # Shape verbatim from docs/omni "image-to-video". Do NOT pass store — default
        # store=true is what keeps this interaction editable for Clip B.
        interaction = client.interactions.create(
            model=MODEL,
            input=[
                {"type": "image", "data": image_b64, "mime_type": "image/jpeg"},
                {"type": "text", "text": PROMPT_EVENING},
            ],
            generation_config={"video_config": {"task": "image_to_video"}},
        )
        print(f"  [{label}] interaction created: id={interaction.id} "
              f"status={getattr(interaction, 'status', 'n/a')!r} ({time.time() - t0:.1f}s)")
        interaction = wait_until_done(client, interaction, label)
        save_video(client, interaction, CLIPS_DIR / "evening.mp4", label)
        latency = time.time() - t0
        print(f"  [{label}] DONE in {latency:.1f}s total")
        record[label] = {"interaction_id": interaction.id, "latency_s": round(latency, 1),
                         "clip": "demo/clips/evening.mp4"}
        save_record(record)
        return True
    except Exception:
        print(f"\n!!! Clip A ({label}) FAILED — error verbatim:", file=sys.stderr)
        traceback.print_exc()
        print(f"!!! re-fire with: python {Path(__file__).name} {image_path} --only evening",
              file=sys.stderr)
        return False


def render_monsoon(client: genai.Client, image_path: Path, record: dict) -> bool:
    """Clip B: video-as-input EDIT of Clip A's mp4. Returns True on success.

    LIVE-TESTED 2026-07-11: previous_interaction_id chaining is REJECTED by the API for
    video ("Video extension is currently not supported" / "previous_interaction_id is not
    allowed when video task is set"). The working path is feeding Clip A's mp4 back as
    video input with task=edit (82s, verified). Docs' multi-turn story is ahead of the
    preview API's reality — keep this shape.
    """
    label = "monsoon"
    clip_a = record.get("evening", {}).get("clip")
    clip_a_path = (REPO_ROOT / clip_a) if clip_a else (CLIPS_DIR / "evening.mp4")
    if not clip_a_path.exists():
        print(f"\n!!! Clip B ({label}) skipped: Clip A not found at {clip_a_path} — "
              f"run evening first.", file=sys.stderr)
        return False
    print(f"\n=== Clip B ({label}): video-input edit of {clip_a_path.name} ===")
    try:
        t0 = time.time()
        video_b64 = base64.b64encode(clip_a_path.read_bytes()).decode("utf-8")
        interaction = client.interactions.create(
            model=MODEL,
            input=[
                {"type": "video", "data": video_b64, "mime_type": "video/mp4"},
                {"type": "text", "text": PROMPT_MONSOON},
            ],
            generation_config={"video_config": {"task": "edit"}},
        )
        print(f"  [{label}] interaction created: id={interaction.id} "
              f"status={getattr(interaction, 'status', 'n/a')!r} ({time.time() - t0:.1f}s)")
        interaction = wait_until_done(client, interaction, label)
        save_video(client, interaction, CLIPS_DIR / "monsoon.mp4", label)
        latency = time.time() - t0
        print(f"  [{label}] DONE in {latency:.1f}s total")
        record[label] = {"interaction_id": interaction.id, "latency_s": round(latency, 1),
                         "clip": "demo/clips/monsoon.mp4",
                         "edited_from": str(clip_a_path.name)}
        save_record(record)
        return True
    except Exception:
        print(f"\n!!! Clip B ({label}) FAILED — error verbatim:", file=sys.stderr)
        traceback.print_exc()
        print(f"!!! Clip A is safe on disk. Re-fire B with: "
              f"python {Path(__file__).name} {image_path} --only monsoon", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description="T10: pre-render Omni Flash demo clips")
    parser.add_argument("image", help="best edited corner image (jpg) from T8, e.g. server/static/b_1_0.jpg")
    parser.add_argument("--only", choices=["evening", "monsoon"],
                        help="re-fire just one clip (monsoon chains off the saved evening id)")
    args = parser.parse_args()

    image_path = Path(args.image).resolve()
    if not image_path.exists():
        sys.exit(f"FATAL: image not found: {image_path}")

    client = genai.Client(api_key=load_api_key())
    record = load_record()

    overall_t0 = time.time()
    results = {}
    if args.only in (None, "evening"):
        results["evening"] = render_evening(client, image_path, record)
    if args.only in (None, "monsoon"):
        # If A just failed in this run, don't chain B off a stale/absent id.
        if args.only is None and results.get("evening") is False:
            print("\n!!! skipping monsoon: evening failed this run", file=sys.stderr)
            results["monsoon"] = False
        else:
            results["monsoon"] = render_monsoon(client, image_path, record)

    print(f"\n=== prerender finished in {time.time() - overall_t0:.1f}s ===")
    for name, ok in results.items():
        print(f"  {name}: {'OK -> demo/clips/' + name + '.mp4' if ok else 'FAILED (re-fire with --only ' + name + ')'}")
    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    main()
