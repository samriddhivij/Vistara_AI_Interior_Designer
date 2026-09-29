#!/usr/bin/env python3
"""
gateway/reconstruct.py — T19: room video -> 3D Gaussian splat (.ply)

    python reconstruct.py tour.mp4 --out scenes/room1 [--fast] [--status-file jobs/x/status.json]

Pipeline (all external tools; this script imports NO torch — it only shells out):
  1. ffmpeg   : extract frames  (~3 fps, <=200 frames, long edge 1280)
  2. VGGT     : feed-forward camera poses -> COLMAP-format sparse/ (seconds on GPU)
                fallback: nerfstudio `ns-process-data images` (COLMAP, 10-40 min)
  3. splatfacto: `ns-train splatfacto` on the posed data (7k iters --fast, else 15k)
  4. export   : `ns-export gaussian-splat` -> .ply
  5. publish  : copy to {out}/scene.ply

Resumable: each step is skipped if its output already exists. Delete the step's
output directory to force a re-run. Designed to run inside `conda activate splat`
on the GPU box (see setup.sh). Every external invocation not runnable on this
dev machine is tagged "# VERIFY on GPU box".
"""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import time

VGGT_DIR = os.environ.get("VGGT_DIR", os.path.expanduser("~/vggt"))

# ---------------------------------------------------------------- status file

_STATUS_PATH = None
_T0 = time.time()


def set_status(state, step, extra=None):
    """Write jobs/{id}/status.json for server.py to poll. Best-effort."""
    if not _STATUS_PATH:
        return
    payload = {
        "state": state,          # queued | processing | done | failed
        "step": step,            # human-readable current step
        "elapsed_s": round(time.time() - _T0, 1),
    }
    if extra:
        payload.update(extra)
    try:
        tmp = _STATUS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(payload, f)
        os.replace(tmp, _STATUS_PATH)  # atomic so the server never reads a torn file
    except OSError as e:
        print(f"[status] WARN could not write {_STATUS_PATH}: {e}")


# ------------------------------------------------------------------- helpers

def die(msg):
    print(f"\nFATAL: {msg}", file=sys.stderr)
    set_status("failed", msg)
    sys.exit(1)


def which_or_die(binary, hint):
    if shutil.which(binary) is None:
        die(f"'{binary}' not on PATH. {hint}")


def run(cmd, step_name, log_file=None):
    """Run a subprocess, stream/tee output, time it, die loudly on failure."""
    print(f"\n[{step_name}] $ {' '.join(cmd)}")
    t = time.time()
    try:
        if log_file:
            with open(log_file, "w") as lf:
                proc = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT)
        else:
            proc = subprocess.run(cmd)
    except FileNotFoundError:
        die(f"[{step_name}] binary not found: {cmd[0]}")
    dt = time.time() - t
    if proc.returncode != 0:
        tail = ""
        if log_file and os.path.exists(log_file):
            with open(log_file, errors="replace") as lf:
                tail = "".join(lf.readlines()[-30:])
        die(f"[{step_name}] exited {proc.returncode} after {dt:.0f}s\n"
            f"--- last log lines ({log_file}) ---\n{tail}")
    print(f"[{step_name}] OK in {dt:.0f}s")
    return dt


def ffprobe_duration(video):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", video],
        capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        print("[frames] WARN: ffprobe could not read duration; assuming 60s")
        return 60.0


# --------------------------------------------------------------------- steps

def step_frames(video, out):
    """(a) ffmpeg: ~3 fps capped at 200 frames, long edge downscaled to 1280."""
    frames_dir = os.path.join(out, "vggt", "images")  # VGGT wants SCENE_DIR/images/
    if glob.glob(os.path.join(frames_dir, "*.jpg")):
        print(f"[frames] SKIP — {frames_dir} already has frames")
        return frames_dir
    which_or_die("ffmpeg", "Run setup.sh (apt install ffmpeg).")
    os.makedirs(frames_dir, exist_ok=True)

    dur = ffprobe_duration(video)
    fps = min(3.0, 200.0 / max(dur, 1.0))  # cap total frames at ~200
    print(f"[frames] video {dur:.0f}s -> sampling at {fps:.2f} fps (<=200 frames)")
    # scale: long edge -> 1280, keep aspect, even dims
    vf = (f"fps={fps:.4f},"
          "scale=w='if(gte(iw,ih),min(1280,iw),-2)':h='if(gte(iw,ih),-2,min(1280,ih))'")
    run(["ffmpeg", "-y", "-i", video, "-vf", vf, "-qscale:v", "2",
         "-frames:v", "200", os.path.join(frames_dir, "frame_%04d.jpg")],
        "frames", os.path.join(out, "logs", "ffmpeg.log"))

    n = len(glob.glob(os.path.join(frames_dir, "*.jpg")))
    if n < 20:
        die(f"only {n} frames extracted — video too short/broken. Need ~100-200. "
            "Re-record: 1-2 min, slow sideways arcs.")
    print(f"[frames] {n} frames in {frames_dir}")
    return frames_dir


def step_poses_vggt(out):
    """(b) VGGT feed-forward poses -> COLMAP format at {out}/vggt/sparse/.

    Exact invocation (per facebookresearch/vggt README, verified 2026-07-11):
        python demo_colmap.py --scene_dir=SCENE_DIR
    where SCENE_DIR contains images/ ; output lands in SCENE_DIR/sparse/
    (cameras.bin, images.bin, points3D.bin — directly consumable by
    nerfstudio's colmap dataparser and by gsplat).
    Optional refinement: --use_ba (bundle adjustment, slower, more robust).
    """
    scene_dir = os.path.join(out, "vggt")
    sparse = os.path.join(scene_dir, "sparse")
    if os.path.exists(os.path.join(sparse, "cameras.bin")):
        print(f"[poses] SKIP — {sparse} already exists")
        return scene_dir

    demo = os.path.join(VGGT_DIR, "demo_colmap.py")
    if not os.path.isfile(demo):
        print(f"[poses] VGGT not found at {VGGT_DIR} (set $VGGT_DIR?) — falling back to COLMAP")
        return None

    # VERIFY on GPU box: VGGT README shows --scene_dir=...; add --use_ba if the
    # feed-forward-only result trains poorly (blurry/misaligned splat).
    run([sys.executable, demo, f"--scene_dir={scene_dir}"],
        "poses-vggt", os.path.join(out, "logs", "vggt.log"))

    if not os.path.exists(os.path.join(sparse, "cameras.bin")):
        print("[poses] VGGT ran but produced no sparse/cameras.bin — falling back to COLMAP")
        return None
    return scene_dir


def step_poses_colmap_fallback(frames_dir, out):
    """(b-fallback) nerfstudio ns-process-data images (COLMAP under the hood)."""
    processed = os.path.join(out, "processed")
    if os.path.exists(os.path.join(processed, "transforms.json")):
        print(f"[poses] SKIP — {processed} already processed")
        return processed
    which_or_die("ns-process-data", "Run setup.sh (pip install nerfstudio).")
    # VERIFY on GPU box: COLMAP path takes 10-40 min for ~200 frames.
    run(["ns-process-data", "images", "--data", frames_dir,
         "--output-dir", processed],
        "poses-colmap", os.path.join(out, "logs", "colmap.log"))
    if not os.path.exists(os.path.join(processed, "transforms.json")):
        die("ns-process-data finished but no transforms.json — COLMAP failed to "
            "register frames. Capture problem: re-record with slow sideways arcs, "
            "60-80% overlap, never pivot in place.")
    return processed


def step_train(data_dir, out, iters, vggt_layout):
    """(c) ns-train splatfacto. Deterministic output path via fixed timestamp."""
    train_dir = os.path.join(out, "train")
    config = os.path.join(train_dir, "scene", "splatfacto", "run", "config.yml")
    if os.path.exists(config):
        print(f"[train] SKIP — {config} exists")
        return config
    which_or_die("ns-train", "Run setup.sh (pip install nerfstudio).")

    cmd = ["ns-train", "splatfacto",
           "--data", data_dir,
           "--output-dir", train_dir,
           "--experiment-name", "scene",
           "--timestamp", "run",                       # deterministic path
           "--max-num-iterations", str(iters),
           "--viewer.quit-on-train-completion", "True",
           "--vis", "viewer"]
    if vggt_layout:
        # VGGT writes SCENE_DIR/sparse + SCENE_DIR/images (no nerfstudio
        # transforms.json), so point the colmap dataparser at them explicitly.
        # VERIFY on GPU box: dataparser flag names (`ns-train splatfacto colmap --help`).
        cmd += ["colmap", "--colmap-path", "sparse", "--images-path", "images"]

    run(cmd, f"train-{iters}it", os.path.join(out, "logs", "train.log"))
    if not os.path.exists(config):
        die(f"training finished but {config} missing — check {out}/logs/train.log")
    return config


def step_export(config, out):
    """(d) ns-export gaussian-splat -> .ply"""
    export_dir = os.path.join(out, "export")
    existing = glob.glob(os.path.join(export_dir, "*.ply"))
    if existing:
        print(f"[export] SKIP — {existing[0]} exists")
        return existing[0]
    which_or_die("ns-export", "Run setup.sh (pip install nerfstudio).")
    # VERIFY on GPU box: output filename is splat.ply on current nerfstudio;
    # we glob *.ply so a rename upstream doesn't break us.
    run(["ns-export", "gaussian-splat", "--load-config", config,
         "--output-dir", export_dir],
        "export", os.path.join(out, "logs", "export.log"))
    plys = glob.glob(os.path.join(export_dir, "*.ply"))
    if not plys:
        die(f"ns-export produced no .ply in {export_dir}")
    return plys[0]


# ---------------------------------------------------------------------- main

def main():
    global _STATUS_PATH
    ap = argparse.ArgumentParser(description="video -> gaussian splat .ply")
    ap.add_argument("video", help="input tour video (mp4)")
    ap.add_argument("--out", required=True, help="output scene dir, e.g. scenes/room1")
    ap.add_argument("--fast", action="store_true",
                    help="7k training iterations (~5-8 min on a 4090) instead of 15k")
    ap.add_argument("--status-file", default=None,
                    help="path to a status.json this script keeps updated (for server.py)")
    args = ap.parse_args()

    _STATUS_PATH = args.status_file
    out = os.path.abspath(args.out)
    video = os.path.abspath(args.video)
    if not os.path.isfile(video):
        die(f"video not found: {video}")
    os.makedirs(os.path.join(out, "logs"), exist_ok=True)

    final_ply = os.path.join(out, "scene.ply")
    if os.path.exists(final_ply):
        print(f"DONE (cached): {final_ply}")
        set_status("done", "cached", {"ply": final_ply})
        return

    iters = 7000 if args.fast else 15000
    print(f"== reconstruct: {video}\n== out: {out}\n== iterations: {iters}")

    set_status("processing", "extracting frames")
    frames_dir = step_frames(video, out)

    set_status("processing", "estimating poses (VGGT)")
    vggt_scene = step_poses_vggt(out)
    if vggt_scene:
        data_dir, vggt_layout = vggt_scene, True
    else:
        set_status("processing", "estimating poses (COLMAP fallback, 10-40 min)")
        data_dir, vggt_layout = step_poses_colmap_fallback(frames_dir, out), False

    set_status("processing", f"training splatfacto ({iters} iters)")
    config = step_train(data_dir, out, iters, vggt_layout)

    set_status("processing", "exporting .ply")
    ply = step_export(config, out)

    shutil.copyfile(ply, final_ply)
    total = time.time() - _T0
    set_status("done", "complete", {"ply": final_ply})
    print(f"\n=============================================")
    print(f"SCENE READY: {final_ply}")
    print(f"TOTAL WALL-CLOCK: {total/60:.1f} min ({total:.0f}s)")
    print(f"=============================================")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        set_status("failed", "interrupted")
        raise
    except SystemExit:
        raise
    except Exception as e:  # any unexpected crash still lands in status.json
        set_status("failed", f"crash: {e}")
        raise
