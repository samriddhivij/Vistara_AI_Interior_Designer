# T19 — 3D Splat Gateway Runbook (go/no-go TONIGHT)

Video of a room → 3D Gaussian splat you can walk through in a browser.
**Rule from TASKBOARD.md:** if tonight's end-to-end run is not clean, the splat is
**CUT** for the event — decided tonight, never revisited. Zero event hours go to fixing it.

## 1. Rent the GPU (10 min)

- **Recommended:** RTX 4090 (24 GB) — ~$0.40–0.70/hr on RunPod or Vast.ai.
  A10G/A100 also fine. 16 GB minimum (VGGT + splatfacto both fit in 24 GB easily).
- Pick an image with **Ubuntu 22.04 + CUDA 12.x preinstalled** (RunPod "PyTorch" or
  plain CUDA templates work). You need SSH and **one exposed TCP port** (8000).
- Note the SSH string and the public IP/port mapping the provider gives you.

## 2. Install (one command, ~15–25 min)

```bash
# from your Mac, in the ghar repo root:
scp -r gateway/ user@GPU_BOX:~/gateway/

# on the box:
ssh user@GPU_BOX
bash ~/gateway/setup.sh          # idempotent — rerun if it dies mid-way
# must end with:  SETUP OK
```

What it installs: ffmpeg + colmap (apt), miniconda, conda env `splat` (py3.10,
torch cu121), VGGT (facebookresearch/vggt, editable install), gsplat, nerfstudio,
fastapi. Every step is skipped if already done.

## 3. Start the gateway

```bash
conda activate splat
cd ~/gateway
uvicorn server:app --host 0.0.0.0 --port 8000
```

Check from your Mac: `curl http://GPU_BOX:8000/` → JSON banner.

## 4. Capture rules (from docs/RESEARCH.md §3 — these decide success)

- **1–2 minutes per room, landscape orientation.**
- Walk **slow sideways arcs** around the room — think crab-walk, camera always
  pointed at the room's center. **60–80% overlap** between viewpoints.
- **NEVER pivot in place** (rotating on the spot gives COLMAP/VGGT no parallax → garbage).
- **Lock exposure/focus** (iPhone: long-press to AE/AF lock). Avoid mirrors and
  big blank walls. Good even lighting.
- Target ends up as ~100–300 frames; the pipeline samples ~3 fps capped at 200.

## 5. Tonight's validation sequence (the go/no-go run)

1. Record a 1–2 min video of ONE room of your house per the rules above.
2. Upload:
   ```bash
   curl -F "file=@room.mp4" http://GPU_BOX:8000/upload
   # -> {"job_id": "abc123..."}
   ```
3. Poll:
   ```bash
   curl http://GPU_BOX:8000/status/abc123...
   # {state: queued|processing|done|failed, step, elapsed_s, ply_url}
   ```
   Expect **5–15 min** total (VGGT poses are seconds; training ~5–8 min at 7k iters).
   If VGGT fails it silently falls back to COLMAP — expect **15–40 min** instead;
   the `step` field tells you which path you're on.
4. Open the viewer on your phone AND laptop:
   ```
   http://GPU_BOX:8000/viewer/?ply=/scenes/abc123.../scene.ply
   ```
   Drag to orbit; click **Walk** for WASD. Room should be recognizable, floors
   flat, no giant floaters in the walking path.
5. (Optional cross-check) download `scene.ply` and drag it into https://superspl.at —
   if it looks good there but not in our viewer, the viewer is the bug, not the pipeline.

You can also run the pipeline directly, skipping the server:
```bash
python reconstruct.py room.mp4 --out scenes/room1 --fast
# prints:  SCENE READY: .../scenes/room1/scene.ply  + total wall-clock
```
It's resumable — rerun after a failure and completed steps are skipped.

## 6. GO / NO-GO criterion (from TASKBOARD.md T19)

**GO** = tonight, one room of Abhishek's house is walkable in a browser,
end-to-end through the upload API, with no manual surgery in the middle.
**NO-GO** = anything else → splat is CUT. Don't negotiate with it at 1 AM.

If GO, event-day flow (background only, never gates the demo):
- T1 (12:00): capture the booth corner video per the rules → `curl -F file=@...` upload
  over venue wifi (fine — batch work, not the demo path).
- Check status at M2 (~2:15) and at 4:00. Ships only if it looks good.
- Link from the app as "Walk this room in 3D". Disclose the open-source pipeline
  (VGGT → gsplat/nerfstudio → Spark) in the README.
- Keep the box rented through judging (~7 hrs ≈ $3–5). Kill it after finals.

## 7. Known failure modes → fixes

| Symptom | Cause | Fix |
|---|---|---|
| `status: failed`, step mentions frames | video too short / unreadable | re-record, 1–2 min |
| COLMAP "failed to register frames" | pivoted in place / low overlap | re-record per §4 |
| Splat is mush / floaters everywhere | motion blur, exposure drift | slower walk, lock AE |
| VGGT OOM on 200 frames | 16 GB card | re-run; or edit reconstruct.py frame cap to 120 |
| Viewer shows room upside-down | axis convention | remove the `splat.quaternion.set(1,0,0,0)` line in viewer/index.html |
| Poses fine, training crashes | gsplat/nerfstudio version clash | `pip install gsplat==1.3.0` and retry train step (resumable) |

## 8. What was NOT verified on this Mac (check on the GPU box)

Everything tagged `# VERIFY on GPU box` in setup.sh / reconstruct.py, chiefly:
- VGGT `demo_colmap.py --scene_dir=...` flags and its `sparse/` output layout
  (invocation matches the repo README as fetched 2026-07-11).
- `ns-train splatfacto ... colmap --colmap-path sparse --images-path images`
  dataparser flags for the VGGT layout (run `ns-train splatfacto colmap --help`).
- `ns-export gaussian-splat` output filename (we glob `*.ply` so it shouldn't matter).
- torch 2.1.2+cu121 pin coexisting with current VGGT requirements.
