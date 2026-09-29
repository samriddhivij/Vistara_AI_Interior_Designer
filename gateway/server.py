#!/usr/bin/env python3
"""
gateway/server.py — T19 upload gateway (runs on the GPU box).

    conda activate splat
    uvicorn server:app --host 0.0.0.0 --port 8000

API:
    POST /upload            multipart 'file' (mp4)   -> {"job_id": "..."}
    GET  /status/{job_id}                            -> {state, step, elapsed_s, ply_url}
    GET  /scenes/{job_id}/scene.ply                  -> the splat (static)
    GET  /viewer/           (serves gateway/viewer/) -> open ?ply=/scenes/{id}/scene.ply

State lives in jobs/{job_id}/status.json, written by reconstruct.py
(--status-file). This server only reads it, so a restart loses nothing.
"""

import json
import os
import subprocess
import sys
import time
import uuid

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE = os.path.dirname(os.path.abspath(__file__))
JOBS = os.path.join(BASE, "jobs")
os.makedirs(JOBS, exist_ok=True)

app = FastAPI(title="ghar splat gateway")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

viewer_dir = os.path.join(BASE, "viewer")
if os.path.isdir(viewer_dir):
    app.mount("/viewer", StaticFiles(directory=viewer_dir, html=True), name="viewer")


def _paths(job_id: str):
    job_dir = os.path.join(JOBS, job_id)
    return {
        "dir": job_dir,
        "video": os.path.join(job_dir, "tour.mp4"),
        "scene": os.path.join(job_dir, "scene"),
        "status": os.path.join(job_dir, "status.json"),
        "ply": os.path.join(job_dir, "scene", "scene.ply"),
        "log": os.path.join(job_dir, "reconstruct.log"),
    }


@app.post("/upload")
async def upload(file: UploadFile = File(...), fast: bool = True):
    job_id = uuid.uuid4().hex[:12]
    p = _paths(job_id)
    os.makedirs(p["dir"], exist_ok=True)

    # Stream the upload to disk (room videos are 100MB+; don't buffer in RAM).
    size = 0
    with open(p["video"], "wb") as out:
        while chunk := await file.read(1 << 20):
            out.write(chunk)
            size += len(chunk)
    if size < 1_000_000:
        raise HTTPException(400, f"upload too small ({size} bytes) — send the actual mp4")

    with open(p["status"], "w") as f:
        json.dump({"state": "queued", "step": "queued", "elapsed_s": 0}, f)

    cmd = [sys.executable, os.path.join(BASE, "reconstruct.py"),
           p["video"], "--out", p["scene"], "--status-file", p["status"]]
    if fast:
        cmd.append("--fast")
    # Detached background subprocess; log to the job dir. reconstruct.py owns
    # status.json from here on (including on crash).
    with open(p["log"], "w") as log:
        subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT,
                         cwd=BASE, start_new_session=True)

    return {"job_id": job_id, "status_url": f"/status/{job_id}"}


@app.get("/status/{job_id}")
def status(job_id: str):
    p = _paths(job_id)
    if not os.path.isdir(p["dir"]):
        raise HTTPException(404, "unknown job_id")
    try:
        with open(p["status"]) as f:
            st = json.load(f)
    except (OSError, json.JSONDecodeError):
        st = {"state": "queued", "step": "starting", "elapsed_s": 0}

    resp = {
        "state": st.get("state", "processing"),
        "step": st.get("step", ""),
        "elapsed_s": st.get("elapsed_s", 0),
        "ply_url": None,
    }
    if os.path.exists(p["ply"]):
        resp["state"] = "done"
        resp["ply_url"] = f"/scenes/{job_id}/scene.ply"
        resp["viewer_url"] = f"/viewer/?ply=/scenes/{job_id}/scene.ply"
    return resp


@app.get("/scenes/{job_id}/scene.ply")
def scene_ply(job_id: str):
    # job_id is validated against the jobs dir; reject path tricks.
    if "/" in job_id or ".." in job_id:
        raise HTTPException(400, "bad job_id")
    p = _paths(job_id)
    if not os.path.exists(p["ply"]):
        raise HTTPException(404, "scene not ready (poll /status/{job_id})")
    return FileResponse(p["ply"], media_type="application/octet-stream",
                        filename="scene.ply")


@app.get("/")
def root():
    return {"service": "ghar splat gateway",
            "upload": "POST /upload (multipart 'file')",
            "time": time.strftime("%Y-%m-%d %H:%M:%S")}
