"""
Vistara server — T8 (/variants) + T15 (/brief), per docs/CONTRACT.md (the contract is LAW).

Run:  cd server && uvicorn app:app --host 0.0.0.0 --port 8000
Env:  GEMINI_API_KEY (required), IMAGE_MODEL (default gemini-3.1-flash-image),
      BRIEF_MODEL (default gemini-3.5-flash), PLAN_MODEL (default gemini-3.1-flash-image)

SDK shapes verified against official docs 2026-07-11:
  https://ai.google.dev/gemini-api/docs/generate-content/image-generation
    client.models.generate_content(model="gemini-3.1-flash-image", contents=[prompt, image])
    -> iterate response.parts, part.inline_data holds the image bytes
  https://ai.google.dev/gemini-api/docs/generate-content/google-search
    types.Tool(google_search=types.GoogleSearch()) inside GenerateContentConfig, response.text
"""

import asyncio
import base64
import json
import os
import re
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------- paths / env

SERVER_DIR = Path(__file__).resolve().parent
STATIC_DIR = SERVER_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)
BRIEF_CACHE_PATH = STATIC_DIR / "brief_cache.json"
BRIEF_CACHE_V2_PATH = STATIC_DIR / "brief_cache_v2.json"  # whole-home era cache


def _load_dotenv() -> None:
    """Tiny .env loader (repo root or server/) so we don't need python-dotenv."""
    for candidate in (SERVER_DIR.parent / ".env", SERVER_DIR / ".env"):
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


_load_dotenv()

# google-genai SDK — lazy client so the app still starts (and /brief cache still
# works) without a key on the machine.
try:
    from google import genai
    from google.genai import types
except ImportError:  # pragma: no cover
    genai = None
    types = None

_client = None


def _get_client():
    global _client
    if _client is None:
        if genai is None:
            raise RuntimeError("google-genai not installed: pip install google-genai")
        # genai.Client() reads GEMINI_API_KEY from the environment (per docs).
        _client = genai.Client()
    return _client


def _image_model() -> str:
    # Read at call time so T3 can flip it via env without code changes.
    return os.environ.get("IMAGE_MODEL", "gemini-3.1-flash-image")


def _brief_model() -> str:
    return os.environ.get("BRIEF_MODEL", "gemini-3.5-flash")


def _tour_model() -> str:
    return os.environ.get("TOUR_MODEL", "gemini-omni-flash-preview")


def _plan_model() -> str:
    return os.environ.get("PLAN_MODEL", "gemini-3.1-flash-image")


# ---------------------------------------------------------------- prompts (docs/PROMPTS.md §3, §6)

EDIT_WRAPPER = (
    "Edit this photograph of a real room. {description}. "
    "Change ONLY the element(s) described. Keep the room's identity intact: same walls, "
    "same window, same floor, same camera angle, same perspective, same time of day. "
    "Photorealistic, natural lighting consistent with the original photo. "
    "This must still be recognizably the same room."
)

FROM_SCRATCH_WRAPPER = (
    "Generate a photorealistic interior-design concept photograph: {description}. "
    "Eye-level wide shot of the whole room, natural lighting, realistic materials and "
    "proportions, Indian home context. Looks like a real photograph, not a 3D render."
)

TOUR_PROMPT = (
    "Create a cinematic walkthrough of this room: the camera slowly dollies forward from "
    "the doorway into the room, gently panning left and then right to reveal the whole "
    "space, smooth steady motion, photorealistic, natural lighting consistent with the "
    "image, no cuts, no people."
)

PLAN_PROMPT = (
    "Draw a clean architectural floor-plan diagram of this home, top-down 2D view, black "
    "line-work on white background with light colour fills per room: {home_description}. "
    "Label every room with its name in clear text. Include door swings, windows, and key "
    "furniture placement as standard architect symbols. Professional drafting style, like a "
    "real estate brochure floor plan. Add a small title block reading "
    "'CONCEPT PLAN — ILLUSTRATIVE, NOT TO SCALE'."
)

VARIANT_SUFFIXES = [
    ", in a warm minimal style with natural materials",
    ", in a contemporary Indian style with cane and block-print textiles",
    ", in a bold color-forward style",
    ", in a budget-friendly style using affordable materials",
]

# {home_block}, {rooms_line}, {rooms_schema}, {rooms_rule} are filled by _build_brief_prompt —
# empty strings for the classic single-room request, so that path reads exactly as before
# plus the always-on materials_and_equipment section.
BRIEF_PROMPT = """You are preparing an architect brief for a {scope} in Bengaluru, India.
{home_block}DESIGN: {description}
OBJECTS TO SOURCE: {objects}
{rooms_line}
Return strict JSON (no markdown fences, no commentary) with exactly this shape:
{{
  "budget": [
    {{ "item": "string", "estimate_inr": 12500, "source_url": "https://... or null", "note": "estimate" }}
  ],
  "total_estimate_inr": 48000,
  "legal": [
    {{ "step": "string", "required": true, "detail": "string" }}
  ]{rooms_schema},
  "materials_and_equipment": [
    {{ "item": "string", "purpose": "string", "estimate_inr": 4500 }}
  ]
}}
1. "budget": for each object, a realistic Indian market price ESTIMATE in INR and a real vendor
   link found via search (prefer Pepperfry, Urban Ladder, IKEA India, Wakefit). Mark every price
   "estimate". If no good link is found, give the estimate with source_url null — never invent URLs.
2. "legal": the approval checklist for this renovation scope in a typical Bengaluru apartment
   society — painting/decor only -> usually no NOC; any civil/structural/electrical work -> society
   NOC (form + notice period), licensed electrician certificate, working-hours rules, debris
   disposal. Include only steps relevant to THIS scope. required: true/false per step.
3. "materials_and_equipment": 8-12 lines of building materials, consumables, tools and contractor
   equipment relevant to THIS scope — think cement, wall putty, electrical wiring, primer and
   paint, brushes/rollers, drilling and other contractor equipment. Every estimate_inr is a rough
   Indian-market ESTIMATE (these are estimates, not quotes); use null if genuinely unsure.
{rooms_rule}Keep it to 5-8 budget lines and 4-6 legal steps. This will be read on a phone screen.
"""

ROOMS_SCHEMA_SNIPPET = """,
  "rooms": [
    { "room": "string", "spec": "string (a 2-line design spec for that room)" }
  ]"""

ROOMS_RULE_SNIPPET = (
    '4. "rooms": one entry per room listed above, each with a tight 2-line design spec an\n'
    "   architect can act on (layout intent, palette/materials, one hero element).\n"
)


def _build_brief_prompt(
    description: str,
    objects: list[str],
    home_description: str | None,
    rooms: list[str] | None,
) -> str:
    return BRIEF_PROMPT.format(
        scope="whole-home design" if home_description else "room redesign",
        home_block=(
            f"HOME (cover the WHOLE home in this brief): {home_description}\n"
            if home_description
            else ""
        ),
        description=description,
        objects=", ".join(objects),
        rooms_line=(f"ROOMS TO SPEC: {', '.join(rooms)}\n" if rooms else ""),
        rooms_schema=ROOMS_SCHEMA_SNIPPET if rooms else "",
        rooms_rule=ROOMS_RULE_SNIPPET if rooms else "",
    )

# ---------------------------------------------------------------- app

app = FastAPI(title="Vistara server")

# Phone hits the laptop over hotspot LAN — allow everything.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# In-memory batch state: batch_id -> [ {slot, status, url}, x4 ]. No DB, no auth.
BATCHES: dict[str, list[dict]] = {}
# In-memory tour state: job_id -> {"status": pending|done|failed, "video_url": str|None}.
TOURS: dict[str, dict] = {}
# In-memory floor-plan state: job_id -> {"status": pending|done|failed, "image_url": str|None}.
PLANS: dict[str, dict] = {}
_bg_tasks: set = set()  # keep refs so background tasks aren't GC'd


class VariantsRequest(BaseModel):
    description: str
    keyframe_b64: str | None = None


class TourRequest(BaseModel):
    image_b64: str | None = None
    image_url: str | None = None
    instruction: str | None = None  # optional extra direction appended to TOUR_PROMPT


class BriefRequest(BaseModel):
    description: str
    objects: list[str]
    home_description: str | None = None  # whole-home scope (voice prompt) — widens the report
    rooms: list[str] | None = None       # per-room 2-line design specs in the report


class PlanRequest(BaseModel):
    home_description: str


class ExportRequest(BaseModel):
    brief: dict                        # the full brief JSON the client already has
    plan_image_url: str | None = None  # a /static/... path served by this server
    home_description: str | None = None


# ---------------------------------------------------------------- /variants

def _decode_keyframe(b64: str) -> bytes:
    # Tolerate a data-URL prefix from the browser ("data:image/jpeg;base64,....").
    if "," in b64 and b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)


def _edit_image_sync(prompt: str, image_bytes: bytes | None) -> bytes:
    """One NB2 call — edit (image + prompt) or from-scratch (prompt only when
    image_bytes is None). Blocking — run via asyncio.to_thread.

    Docs (image-generation, generateContent flavor) show contents=[prompt, PIL_image];
    types.Part.from_bytes is the SDK's byte-input equivalent (same docs site, image
    understanding pages). Live-verified per docs/ABHI-DELTA.md (edit path).
    """
    client = _get_client()
    if image_bytes is not None:
        contents = [types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"), prompt]
    else:
        contents = [prompt]
    response = client.models.generate_content(
        model=_image_model(),
        contents=contents,
    )
    for part in response.parts:
        if getattr(part, "inline_data", None) is not None and part.inline_data.data:
            data = part.inline_data.data
            if isinstance(data, str):  # defensive: some SDK versions return base64 str
                data = base64.b64decode(data)
            return data
    raise RuntimeError("model returned no image part")


async def _run_slot(batch_id: str, slot: int, description: str, image_bytes: bytes | None) -> None:
    wrapper = EDIT_WRAPPER if image_bytes is not None else FROM_SCRATCH_WRAPPER
    prompt = wrapper.format(description=description) + VARIANT_SUFFIXES[slot]
    try:
        out = await asyncio.to_thread(_edit_image_sync, prompt, image_bytes)
        filename = f"{batch_id}_{slot}.jpg"
        (STATIC_DIR / filename).write_bytes(out)
        BATCHES[batch_id][slot] = {"slot": slot, "status": "done", "url": f"/static/{filename}"}
    except Exception as exc:  # noqa: BLE001 — demo: fail the slot, never the batch
        print(f"[variants] {batch_id} slot {slot} FAILED: {exc}")
        BATCHES[batch_id][slot] = {"slot": slot, "status": "failed", "url": None}


async def _run_batch(batch_id: str, description: str, image_bytes: bytes | None) -> None:
    t0 = time.time()
    await asyncio.gather(*(_run_slot(batch_id, s, description, image_bytes) for s in range(4)))
    done = sum(1 for i in BATCHES[batch_id] if i["status"] == "done")
    print(f"[variants] {batch_id}: {done}/4 done in {time.time() - t0:.1f}s")


@app.post("/variants")
async def post_variants(req: VariantsRequest):
    # keyframe optional: with it -> edit the photo; without it -> generate from scratch.
    image_bytes = None
    if req.keyframe_b64 is not None:
        try:
            image_bytes = _decode_keyframe(req.keyframe_b64)
        except Exception:
            raise HTTPException(status_code=400, detail="keyframe_b64 is not valid base64")

    batch_id = f"b_{uuid.uuid4().hex[:8]}"
    BATCHES[batch_id] = [{"slot": s, "status": "pending", "url": None} for s in range(4)]

    task = asyncio.create_task(_run_batch(batch_id, req.description, image_bytes))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)

    # Contract: immediate (<500ms), before any image exists.
    return {"batch_id": batch_id, "count": 4}


@app.get("/variants/{batch_id}")
async def get_variants(batch_id: str):
    if batch_id not in BATCHES:
        raise HTTPException(status_code=404, detail="unknown batch_id")
    return {"batch_id": batch_id, "images": BATCHES[batch_id]}


# ---------------------------------------------------------------- /tour

def _tour_sync(image_b64: str, prompt: str) -> bytes:
    """One Omni Flash image-to-video call. Blocking (40-120s) — run via asyncio.to_thread.

    Call shape LIVE-VERIFIED 2026-07-11 (docs/ABHI-DELTA.md §1) — do not improvise.
    Output handling copied from server/scripts/prerender.py save_video/wait_until_done.
    """
    client = _get_client()
    interaction = client.interactions.create(
        model=_tour_model(),
        input=[
            {"type": "image", "data": image_b64, "mime_type": "image/jpeg"},
            {"type": "text", "text": prompt},
        ],
        generation_config={"video_config": {"task": "image_to_video"}},
    )

    # create() usually returns completed inline (per ABHI-DELTA live runs); poll if not.
    start = time.time()
    while True:
        status = getattr(interaction, "status", None)
        if status == "completed" or (status is None and getattr(interaction, "output_video", None)):
            break
        if status in ("failed", "cancelled", "incomplete", "budget_exceeded", "requires_action"):
            raise RuntimeError(f"tour interaction {interaction.id} ended with status={status!r}")
        if time.time() - start > 10 * 60:
            raise TimeoutError(f"tour interaction {interaction.id} still {status!r} after 10min")
        time.sleep(5)
        try:  # VERIFY: interactions.get kwarg name (same caveat as prerender.py)
            interaction = client.interactions.get(interaction.id)
        except TypeError:
            interaction = client.interactions.get(id=interaction.id)

    video = getattr(interaction, "output_video", None)
    if video is None:
        raise RuntimeError(f"tour interaction {interaction.id} completed but has no output_video")

    data = getattr(video, "data", None)
    if data:
        return base64.b64decode(data) if isinstance(data, str) else data
    if getattr(video, "uri", None):
        # >4MB videos come back as a Files API uri (pattern from prerender.py save_video).
        file_name = video.uri.split("/")[-1]
        while True:
            f_info = client.files.get(name=f"files/{file_name}")
            state = getattr(f_info.state, "name", f_info.state)
            if state == "ACTIVE":
                break
            if state == "FAILED":
                raise RuntimeError(f"tour: file {video.uri} state=FAILED")
            time.sleep(5)
        return client.files.download(file=video.uri)
    raise RuntimeError("tour: output_video has neither data nor uri")


async def _run_tour(job_id: str, image_b64: str, prompt: str) -> None:
    t0 = time.time()
    try:
        video_bytes = await asyncio.to_thread(_tour_sync, image_b64, prompt)
        filename = f"tour_{job_id}.mp4"
        (STATIC_DIR / filename).write_bytes(video_bytes)
        TOURS[job_id] = {"status": "done", "video_url": f"/static/{filename}"}
        print(f"[tour] {job_id}: done in {time.time() - t0:.1f}s ({len(video_bytes) / 1e6:.1f} MB)")
    except Exception as exc:  # noqa: BLE001 — demo: fail the job, never the server
        print(f"[tour] {job_id} FAILED after {time.time() - t0:.1f}s: {exc}")
        TOURS[job_id] = {"status": "failed", "video_url": None}


@app.post("/tour")
async def post_tour(req: TourRequest):
    if (req.image_b64 is None) == (req.image_url is None):
        raise HTTPException(status_code=400,
                            detail="provide exactly one of image_b64 or image_url")

    if req.image_b64 is not None:
        try:
            image_bytes = _decode_keyframe(req.image_b64)
        except Exception:
            raise HTTPException(status_code=400, detail="image_b64 is not valid base64")
    else:
        # Only our own /static/ paths — read straight off disk, no fetching.
        if not req.image_url.startswith("/static/"):
            raise HTTPException(status_code=400,
                                detail="image_url must be a /static/... path served by this server")
        name = Path(req.image_url).name  # strip any path tricks
        file_path = STATIC_DIR / name
        if not file_path.is_file():
            raise HTTPException(status_code=404, detail=f"no such static file: {name}")
        image_bytes = file_path.read_bytes()

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    prompt = TOUR_PROMPT
    if req.instruction is not None:
        prompt += f" Additional direction: {req.instruction}."

    job_id = f"t_{uuid.uuid4().hex[:8]}"
    TOURS[job_id] = {"status": "pending", "video_url": None}

    task = asyncio.create_task(_run_tour(job_id, image_b64, prompt))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)

    return {"job_id": job_id}


@app.get("/tour/{job_id}")
async def get_tour(job_id: str):
    if job_id not in TOURS:
        raise HTTPException(status_code=404, detail="unknown job_id")
    entry = TOURS[job_id]
    return {"job_id": job_id, "status": entry["status"], "video_url": entry["video_url"]}


# ---------------------------------------------------------------- /plan

def _plan_sync(home_description: str) -> bytes:
    """ONE image-generation call for the floor plan. Blocking — run via asyncio.to_thread.

    Same generate_content shape as _edit_image_sync's from-scratch path (docs:
    generate-content/image-generation), just a different prompt and PLAN_MODEL env.
    """
    client = _get_client()
    response = client.models.generate_content(
        model=_plan_model(),
        contents=[PLAN_PROMPT.format(home_description=home_description)],
    )
    for part in response.parts:
        if getattr(part, "inline_data", None) is not None and part.inline_data.data:
            data = part.inline_data.data
            if isinstance(data, str):  # defensive: some SDK versions return base64 str
                data = base64.b64decode(data)
            return data
    raise RuntimeError("model returned no image part")


async def _run_plan(job_id: str, home_description: str) -> None:
    t0 = time.time()
    try:
        image_bytes = await asyncio.to_thread(_plan_sync, home_description)
        filename = f"plan_{job_id}.jpg"
        (STATIC_DIR / filename).write_bytes(image_bytes)
        PLANS[job_id] = {"status": "done", "image_url": f"/static/{filename}"}
        print(f"[plan] {job_id}: done in {time.time() - t0:.1f}s")
    except Exception as exc:  # noqa: BLE001 — demo: fail the job, never the server
        print(f"[plan] {job_id} FAILED after {time.time() - t0:.1f}s: {exc}")
        PLANS[job_id] = {"status": "failed", "image_url": None}


@app.post("/plan")
async def post_plan(req: PlanRequest):
    job_id = f"p_{uuid.uuid4().hex[:8]}"
    PLANS[job_id] = {"status": "pending", "image_url": None}

    task = asyncio.create_task(_run_plan(job_id, req.home_description))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)

    # Immediate, before the image exists.
    return {"job_id": job_id}


@app.get("/plan/{job_id}")
async def get_plan(job_id: str):
    if job_id not in PLANS:
        raise HTTPException(status_code=404, detail="unknown job_id")
    entry = PLANS[job_id]
    return {"job_id": job_id, "status": entry["status"], "image_url": entry["image_url"]}


# ---------------------------------------------------------------- /brief

def _extract_json(text: str) -> dict:
    """Robustly pull a JSON object out of model text (strip ``` fences etc.)."""
    text = re.sub(r"```(?:json)?", "", text).strip().strip("`")
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in model output: {text[:200]!r}")
    return json.loads(text[start : end + 1])


def _brief_call_sync(
    description: str,
    objects: list[str],
    home_description: str | None = None,
    rooms: list[str] | None = None,
) -> dict:
    """ONE grounded text call. Shape verified against docs/generate-content/google-search."""
    client = _get_client()
    response = client.models.generate_content(
        model=_brief_model(),
        contents=_build_brief_prompt(description, objects, home_description, rooms),
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
    )
    brief = _extract_json(response.text)
    # Minimal shape guard against the CONTRACT.md schema.
    if "budget" not in brief or "legal" not in brief:
        raise ValueError("brief JSON missing budget/legal keys")
    brief.setdefault(
        "total_estimate_inr",
        sum(int(line.get("estimate_inr") or 0) for line in brief["budget"]),
    )
    return brief


@app.post("/brief")
async def post_brief(req: BriefRequest):
    # Demo path: the cache IS the demo, the live call is the fallback (T15).
    # Whole-home requests skip the room-era brief_cache.json (it predates
    # home_description/rooms) and use their own v2 cache instead.
    if req.home_description is not None:
        if BRIEF_CACHE_V2_PATH.exists():
            return json.loads(BRIEF_CACHE_V2_PATH.read_text())
    elif BRIEF_CACHE_PATH.exists():
        return json.loads(BRIEF_CACHE_PATH.read_text())

    try:
        brief = await asyncio.to_thread(
            _brief_call_sync, req.description, req.objects, req.home_description, req.rooms
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[brief] live call FAILED: {exc}")
        # Last-ditch: ship the committed example so the demo never dies on stage.
        example = STATIC_DIR / "brief_cache_example.json"
        if example.exists():
            return json.loads(example.read_text())
        raise HTTPException(status_code=502, detail=f"brief generation failed: {exc}")

    cache_path = BRIEF_CACHE_V2_PATH if req.home_description is not None else BRIEF_CACHE_PATH
    cache_path.write_text(json.dumps(brief, indent=2, ensure_ascii=False))
    return brief


# ---------------------------------------------------------------- /export

EXPORT_DISCLAIMER = (
    "Concept pack generated by Vistara — floor plan illustrative, not to scale. "
    "All prices are estimates."
)

EXPORT_CSS = """
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #000; background: #fff; margin: 0 auto; padding: 24px;
    max-width: 760px; line-height: 1.45; font-size: 13px;
  }
  header { border-bottom: 3px solid #000; padding-bottom: 12px; margin-bottom: 24px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: 0.01em; }
  .meta { font-size: 12px; color: #444; margin: 0; }
  .home-desc { font-size: 14px; margin: 10px 0 0; }
  section { margin: 0 0 28px; page-break-inside: avoid; }
  h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
    border-bottom: 1px solid #000; padding-bottom: 4px; margin: 0 0 10px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ccc; vertical-align: top; }
  th { border-bottom: 1.5px solid #000; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.amount, th.amount { text-align: right; white-space: nowrap; }
  tr.total td { border-top: 2px solid #000; border-bottom: none; font-weight: 700; }
  .tag { font-size: 10px; border: 1px solid #999; border-radius: 4px; padding: 0 4px; color: #555; margin-left: 4px; }
  .url { font-size: 11px; color: #333; word-break: break-all; display: block; margin-top: 2px; }
  .plan-img { width: 100%; border: 1px solid #000; display: block; }
  .plan-note { font-size: 11px; font-style: italic; color: #444; margin-top: 6px; }
  ul.legal { list-style: none; margin: 0; padding: 0; }
  ul.legal li { padding: 6px 0; border-bottom: 1px solid #ccc; }
  ul.legal .req { font-weight: 700; font-size: 10px; letter-spacing: 0.05em; }
  ul.legal .detail { display: block; color: #333; font-size: 12px; margin-top: 2px; }
  footer { border-top: 1px solid #000; margin-top: 32px; padding-top: 10px; font-size: 11px; font-style: italic; color: #444; }
  @media print { body { padding: 0; } }
"""


def _esc(value) -> str:
    """Minimal HTML escaping for model/user-provided strings."""
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _inr(value) -> str:
    """₹ formatting with Indian digit grouping (₹2,78,093). '—' when unknown."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return "—"
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups) + "," + tail
    return f"{sign}₹{s}"


def _plan_data_uri(plan_image_url: str | None) -> str | None:
    """Read the plan image off STATIC_DIR (same safety pattern as /tour's
    image_url handling — Path(...).name strips path tricks). None if missing."""
    if not plan_image_url or not plan_image_url.startswith("/static/"):
        return None
    name = Path(plan_image_url).name
    file_path = STATIC_DIR / name
    if not file_path.is_file():
        return None
    suffix = file_path.suffix.lower()
    mime = "image/png" if suffix == ".png" else "image/jpeg"
    b64 = base64.b64encode(file_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _render_export_html(brief: dict, plan_data_uri: str | None,
                        home_description: str | None) -> str:
    parts: list[str] = []
    date_str = time.strftime("%d %B %Y")

    parts.append("<header>")
    parts.append("<h1>Vistara — Architect Pack</h1>")
    parts.append(f'<p class="meta">Generated {_esc(date_str)}</p>')
    if home_description:
        parts.append(f'<p class="home-desc">{_esc(home_description)}</p>')
    parts.append("</header>")

    # Floor plan (skipped entirely when no image is available)
    if plan_data_uri:
        parts.append("<section>")
        parts.append("<h2>Concept floor plan</h2>")
        parts.append(f'<img class="plan-img" src="{plan_data_uri}" '
                     'alt="Concept floor plan" />')
        parts.append('<p class="plan-note">Illustrative concept only — not to scale, '
                     "not a construction drawing.</p>")
        parts.append("</section>")

    # Room-by-room specs
    rooms = brief.get("rooms") or []
    if isinstance(rooms, list) and rooms:
        parts.append("<section>")
        parts.append("<h2>Room-by-room specs</h2>")
        parts.append("<table><thead><tr><th>Room</th><th>Design spec</th></tr></thead><tbody>")
        for r in rooms:
            parts.append(
                f"<tr><td><strong>{_esc(r.get('room', ''))}</strong></td>"
                f"<td>{_esc(r.get('spec', ''))}</td></tr>"
            )
        parts.append("</tbody></table></section>")

    # Budget
    budget = brief.get("budget") or []
    if isinstance(budget, list) and budget:
        parts.append("<section>")
        parts.append('<h2>Budget <span class="tag">all estimates</span></h2>')
        parts.append('<table><thead><tr><th>Item</th><th class="amount">Estimate</th>'
                     "</tr></thead><tbody>")
        for b in budget:
            url = b.get("source_url")
            vendor = f'<span class="url">{_esc(url)}</span>' if url else ""
            parts.append(
                f"<tr><td>{_esc(b.get('item', ''))}{vendor}</td>"
                f'<td class="amount">{_inr(b.get("estimate_inr"))}'
                '<span class="tag">estimate</span></td></tr>'
            )
        parts.append(
            '<tr class="total"><td>Total</td>'
            f'<td class="amount">{_inr(brief.get("total_estimate_inr"))}'
            '<span class="tag">estimate</span></td></tr>'
        )
        parts.append("</tbody></table></section>")

    # Materials & equipment
    materials = brief.get("materials_and_equipment") or []
    if isinstance(materials, list) and materials:
        parts.append("<section>")
        parts.append('<h2>Materials &amp; equipment <span class="tag">all estimates</span></h2>')
        parts.append('<table><thead><tr><th>Item</th><th>Purpose</th>'
                     '<th class="amount">Estimate</th></tr></thead><tbody>')
        for m in materials:
            parts.append(
                f"<tr><td>{_esc(m.get('item', ''))}</td>"
                f"<td>{_esc(m.get('purpose', ''))}</td>"
                f'<td class="amount">{_inr(m.get("estimate_inr"))}'
                '<span class="tag">estimate</span></td></tr>'
            )
        parts.append("</tbody></table></section>")

    # Legal checklist
    legal = brief.get("legal") or []
    if isinstance(legal, list) and legal:
        parts.append("<section>")
        parts.append("<h2>Approvals &amp; legal checklist</h2>")
        parts.append('<ul class="legal">')
        for l in legal:
            req = "REQUIRED" if l.get("required") else "NOT REQUIRED"
            parts.append(
                f'<li><span class="req">[{req}]</span> '
                f"<strong>{_esc(l.get('step', ''))}</strong>"
                f'<span class="detail">{_esc(l.get("detail", ""))}</span></li>'
            )
        parts.append("</ul></section>")

    parts.append(f"<footer>{_esc(EXPORT_DISCLAIMER)}</footer>")

    body = "\n".join(parts)
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n<head>\n<meta charset="utf-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />\n'
        "<title>Vistara — Architect Pack</title>\n"
        f"<style>{EXPORT_CSS}</style>\n</head>\n<body>\n{body}\n</body>\n</html>\n"
    )


@app.post("/export")
async def post_export(req: ExportRequest):
    """Self-contained, print-ready HTML architect pack (the download/hand-off
    artifact). Floor plan embedded as a base64 data-URI; no external assets."""
    plan_data_uri = _plan_data_uri(req.plan_image_url)
    html = _render_export_html(req.brief, plan_data_uri, req.home_description)
    return Response(
        content=html,
        media_type="text/html",
        headers={
            "Content-Disposition": 'attachment; filename="vistara-architect-pack.html"',
        },
    )


@app.get("/")
async def root():
    return {"ok": True, "image_model": _image_model(), "brief_model": _brief_model()}
