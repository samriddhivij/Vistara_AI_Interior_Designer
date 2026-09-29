#!/usr/bin/env python3
"""T3 — Image-model shootout + Omni validation (see TASKBOARD.md).

Run from anywhere:  python server/scripts/validate.py

What it does:
  1. Same edit ("replace the chair with a rattan armchair") on demo/fixtures/corner.jpg
     through BOTH gemini-3.1-flash-image (NB2) and gemini-3.1-flash-lite-image (NB2 Lite).
     Outputs -> demo/fixtures/edit_nb2.jpg / edit_nb2lite.jpg. Prints latency per model.
  2. Animates the better edit (NB2 by default) with gemini-omni-flash-preview via the
     Interactions API (Clip A "golden hour" prompt). Saves interaction id ->
     demo/fixtures/omni_interaction_id.txt, video -> demo/clips/validate_clipA.mp4.
  3. Prints a REPORT block: latencies, model pick guidance, quota errors VERBATIM.

SDK shapes verified against https://ai.google.dev/gemini-api/docs/image-generation,
/docs/omni and /docs/interactions on 2026-07-11 (Interactions API surface:
client.interactions.create(model=..., input=[{"type": "image"|"text", ...}]),
interaction.output_image.data / interaction.output_video.data are base64 strings;
never set store=false — it breaks previous_interaction_id edit chains).
"""

import base64
import os
import sys
import time
import traceback
from pathlib import Path

# ---------------------------------------------------------------- paths -----
REPO_ROOT = Path(__file__).resolve().parents[2]          # server/scripts/ -> repo root
FIXTURES = REPO_ROOT / "demo" / "fixtures"
CLIPS = REPO_ROOT / "demo" / "clips"
CORNER = FIXTURES / "corner.jpg"

NB2 = "gemini-3.1-flash-image"
NB2_LITE = "gemini-3.1-flash-lite-image"
OMNI = "gemini-omni-flash-preview"

# ------------------------------------------------------------- prompts ------
# docs/PROMPTS.md section 3 — edit wrapper, with the T3 shootout description baked in.
EDIT_DESCRIPTION = "Replace the chair with a rattan armchair, keep everything else identical"
EDIT_PROMPT = (
    f"Edit this photograph of a real room. {EDIT_DESCRIPTION}.\n"
    "Change ONLY the element(s) described. Keep the room's identity intact: same walls, "
    "same window, same floor, same camera angle, same perspective, same time of day. "
    "Photorealistic, natural lighting consistent with the original photo. This must still "
    "be recognizably the same room."
)

# docs/PROMPTS.md section 4 — Clip A.
CLIP_A_PROMPT = (
    "Animate this room. A slow golden-hour pass: warm evening sunlight slides across the "
    "floor and walls, shadows lengthen naturally, curtains breathe gently in a light breeze. "
    "Camera locked, no cuts, photorealistic, calm."
)


# ---------------------------------------------------------------- env -------
def load_api_key() -> str:
    """GEMINI_API_KEY from env, else parse repo-root .env by hand (no hard dotenv dep)."""
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    try:  # python-dotenv if it happens to be installed
        from dotenv import load_dotenv
        load_dotenv(REPO_ROOT / ".env")
        key = os.environ.get("GEMINI_API_KEY")
        if key:
            return key
    except ImportError:
        pass
    env_file = REPO_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("GEMINI_API_KEY=") and not line.startswith("#"):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
                if key:
                    return key
    print("FATAL: GEMINI_API_KEY not found in environment or", env_file)
    sys.exit(1)


# --------------------------------------------------------- extraction -------
def extract_image_b64(interaction):
    """Base64 image data from an Interactions response.

    Docs: interaction.output_image.data is the convenience field (last generated image
    block); the robust path is iterating interaction.steps -> model_output -> content
    blocks with type == "image".
    """
    out = getattr(interaction, "output_image", None)
    if out is not None and getattr(out, "data", None):
        return out.data
    for step in getattr(interaction, "steps", None) or []:
        if getattr(step, "type", None) == "model_output":
            for block in getattr(step, "content", None) or []:
                if getattr(block, "type", None) == "image" and getattr(block, "data", None):
                    return block.data
    return None


def is_quota_error(exc: BaseException) -> bool:
    s = repr(exc)
    return any(t in s for t in ("429", "RESOURCE_EXHAUSTED", "quota", "Quota", "rate limit", "rateLimit"))


# ------------------------------------------------------ step 1+2: images ----
def run_image_edit(client, model_id: str, image_bytes: bytes, out_path: Path):
    """One image edit via the Interactions API. Returns (latency_s|None, error_str|None)."""
    print(f"\n--- IMAGE EDIT: {model_id} ---")
    try:
        t0 = time.time()
        interaction = client.interactions.create(
            model=model_id,
            input=[
                {"type": "text", "text": EDIT_PROMPT},
                {
                    "type": "image",
                    "data": base64.b64encode(image_bytes).decode("utf-8"),
                    "mime_type": "image/jpeg",
                },
            ],
        )
        latency = time.time() - t0
        img_b64 = extract_image_b64(interaction)
        if not img_b64:
            err = f"{model_id}: response contained no image block (interaction id={getattr(interaction, 'id', '?')})"
            print("ERROR:", err)
            return None, err
        out_path.write_bytes(base64.b64decode(img_b64))
        print(f"OK  {model_id}: {latency:.1f}s -> {out_path}")
        return latency, None
    except Exception as exc:  # print verbatim, never crash the next step
        print(f"ERROR ({model_id}) VERBATIM:")
        traceback.print_exc()
        return None, repr(exc)


# ----------------------------------------------------------- step 3: omni ---
def run_omni(client, image_path: Path):
    """Animate the edited corner with Omni Flash. Returns (latency_s|None, error|None)."""
    print(f"\n--- OMNI TEST: {OMNI} on {image_path.name} ---")
    try:
        image_bytes = image_path.read_bytes()
        t0 = time.time()
        # NOTE: do NOT set store=false — default store=true is required for
        # previous_interaction_id edit chains (Clip B in T10 chains off this id).
        interaction = client.interactions.create(
            model=OMNI,
            input=[
                {
                    "type": "image",
                    "data": base64.b64encode(image_bytes).decode("utf-8"),
                    "mime_type": "image/jpeg",
                },
                {"type": "text", "text": CLIP_A_PROMPT},
            ],
            generation_config={"video_config": {"task": "image_to_video"}},
        )
        latency = time.time() - t0

        interaction_id = getattr(interaction, "id", None)
        if interaction_id:
            id_file = FIXTURES / "omni_interaction_id.txt"
            id_file.write_text(interaction_id + "\n")
            print(f"interaction id: {interaction_id}  (saved -> {id_file})")
            print("  ^ T10 uses this as previous_interaction_id for Clip B (monsoon).")

        video_out = getattr(interaction, "output_video", None)
        if video_out is None:
            err = f"omni: no output_video on interaction {interaction_id}"
            print("ERROR:", err)
            return latency, err

        CLIPS.mkdir(parents=True, exist_ok=True)
        clip_path = CLIPS / "validate_clipA.mp4"

        if getattr(video_out, "data", None):
            # Inline base64 delivery (videos under ~4MB).
            clip_path.write_bytes(base64.b64decode(video_out.data))
        elif getattr(video_out, "uri", None):
            # URI delivery: poll the file until ACTIVE, then download (per /docs/omni).
            file_name = video_out.uri.split("/")[-1]
            print(f"video via uri {video_out.uri} — polling file state...")
            deadline = time.time() + 600
            while time.time() < deadline:
                f_info = client.files.get(name=f"files/{file_name}")
                state = getattr(getattr(f_info, "state", None), "name", str(getattr(f_info, "state", "?")))
                if state == "ACTIVE":
                    break
                if state == "FAILED":
                    err = f"omni: file processing FAILED for {video_out.uri}"
                    print("ERROR:", err)
                    return latency, err
                time.sleep(5)
            video_bytes = client.files.download(file=video_out.uri)
            clip_path.write_bytes(video_bytes)
            latency = time.time() - t0  # include download wait in wall clock
        else:
            err = f"omni: output_video has neither .data nor .uri (interaction {interaction_id})"
            print("ERROR:", err)
            return latency, err

        print(f"OK  omni: {latency:.1f}s total -> {clip_path}")
        return latency, None
    except Exception as exc:
        print(f"ERROR ({OMNI}) VERBATIM:")
        traceback.print_exc()
        return None, repr(exc)


# --------------------------------------------------------------- main -------
def main():
    if not CORNER.exists():
        print(f"ADD FIXTURE: demo/fixtures/corner.jpg — photograph the booth corner (T1) "
              f"and put it at {CORNER}, then re-run.")
        sys.exit(1)

    api_key = load_api_key()
    from google import genai  # import after key check so the error message is ours
    client = genai.Client(api_key=api_key)

    corner_bytes = CORNER.read_bytes()
    FIXTURES.mkdir(parents=True, exist_ok=True)

    # Step 1 + 2: shootout (each call has its own try/except inside run_image_edit)
    nb2_latency, nb2_err = run_image_edit(client, NB2, corner_bytes, FIXTURES / "edit_nb2.jpg")
    lite_latency, lite_err = run_image_edit(client, NB2_LITE, corner_bytes, FIXTURES / "edit_nb2lite.jpg")

    # Step 3: omni on the better edit — NB2 output by default, Lite as fallback.
    omni_source = None
    if nb2_err is None:
        omni_source = FIXTURES / "edit_nb2.jpg"
    elif lite_err is None:
        omni_source = FIXTURES / "edit_nb2lite.jpg"
        print("\nWARN: NB2 edit failed — animating the Lite output instead.")

    if omni_source is not None:
        omni_latency, omni_err = run_omni(client, omni_source)
    else:
        omni_latency, omni_err = None, "SKIPPED: both image edits failed, nothing to animate"
        print("\n" + omni_err)

    # ------------------------------------------------------------ REPORT ----
    quota_errors = [e for e in (nb2_err, lite_err, omni_err) if e]

    def fmt(lat, err):
        if lat is not None and err is None:
            return f"{lat:.1f}s"
        return f"FAILED ({err})"

    print("\n" + "=" * 70)
    print("REPORT — T3 image shootout + Omni validation")
    print("=" * 70)
    print(f"NB2      {NB2:35s} {fmt(nb2_latency, nb2_err)}   -> demo/fixtures/edit_nb2.jpg")
    print(f"NB2 Lite {NB2_LITE:35s} {fmt(lite_latency, lite_err)}   -> demo/fixtures/edit_nb2lite.jpg")
    print(f"Omni     {OMNI:35s} {fmt(omni_latency, omni_err)}   -> demo/clips/validate_clipA.mp4")
    print("-" * 70)
    if nb2_err is None and lite_err is None:
        print("PICK: default to NB2 (gemini-3.1-flash-image) — docs say Lite is NOT")
        print("optimized for editing. NOW EYEBALL BOTH JPGs: does each still look like")
        print("OUR corner (same walls/window/floor/angle)? Room-identity beats latency.")
        print("Only pick Lite if NB2 identity is fine but too slow for the rail (>~15s).")
    elif nb2_err is None:
        print("PICK: NB2 (Lite failed). Eyeball edit_nb2.jpg for room identity.")
    elif lite_err is None:
        print("PICK: Lite by elimination (NB2 failed) — retry NB2 before locking CONTRACT.md.")
    else:
        print("PICK: NONE — both image models failed. Fix errors above before M1.")
    print("-" * 70)
    if quota_errors:
        print("QUOTA / API ERRORS (verbatim):")
        for e in quota_errors:
            marker = "  [QUOTA/RATE-LIMIT] " if is_quota_error(Exception(e)) else "  "
            print(marker + e)
    else:
        print("No quota/rate-limit errors.")
    print("=" * 70)
    print("Write the winning model ID into docs/CONTRACT.md at M1.")


if __name__ == "__main__":
    main()
