#!/usr/bin/env bash
# =============================================================================
# gateway/setup.sh — T19 splat gateway bootstrap
#
# Target: FRESH Ubuntu 22.04 cloud GPU box (RunPod / Lambda / Vast style)
#         with an NVIDIA driver + CUDA 12.x already present (nvidia-smi works).
# Idempotent: safe to re-run; every step checks before it acts.
#
# Usage:   bash setup.sh
# Ends with "SETUP OK" on success. Anything else = read the last lines.
# =============================================================================
set -euo pipefail

log()  { echo -e "\n==> $*"; }
die()  { echo -e "\nSETUP FAILED: $*" >&2; exit 1; }

GATEWAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINICONDA_DIR="${HOME}/miniconda3"
ENV_NAME="splat"
VGGT_DIR="${HOME}/vggt"

# -----------------------------------------------------------------------------
# 0. Sanity: GPU visible?
# -----------------------------------------------------------------------------
log "[0/6] Checking GPU"
if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader \
        || die "nvidia-smi exists but failed — driver problem on this box"
else
    die "nvidia-smi not found. This box has no NVIDIA driver — rent a different one."
fi

# -----------------------------------------------------------------------------
# 1. apt deps (ffmpeg for frame extraction, colmap as the classic SfM fallback)
# -----------------------------------------------------------------------------
log "[1/6] apt dependencies (ffmpeg, colmap, build tools)"
export DEBIAN_FRONTEND=noninteractive
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi
$SUDO apt-get update -y
# colmap from apt is CPU-feature-matcher only but fine as a fallback path.
$SUDO apt-get install -y ffmpeg colmap git wget curl build-essential unzip
command -v ffmpeg >/dev/null || die "ffmpeg missing after apt install"
command -v colmap >/dev/null || echo "WARN: colmap not installed via apt (fallback path degraded, VGGT path unaffected)"

# -----------------------------------------------------------------------------
# 2. Miniconda (only if no conda already on the box)
# -----------------------------------------------------------------------------
log "[2/6] Miniconda"
if command -v conda >/dev/null 2>&1; then
    echo "conda already present: $(command -v conda)"
elif [ -x "${MINICONDA_DIR}/bin/conda" ]; then
    echo "miniconda already installed at ${MINICONDA_DIR}"
else
    wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/miniconda.sh
    bash /tmp/miniconda.sh -b -p "${MINICONDA_DIR}"
    rm -f /tmp/miniconda.sh
fi
# Make conda usable in this non-interactive shell.
if [ -x "${MINICONDA_DIR}/bin/conda" ]; then
    # shellcheck disable=SC1091
    source "${MINICONDA_DIR}/etc/profile.d/conda.sh"
else
    CONDA_BASE="$(conda info --base)"
    # shellcheck disable=SC1091
    source "${CONDA_BASE}/etc/profile.d/conda.sh"
fi

# -----------------------------------------------------------------------------
# 3. conda env `splat` with python 3.10 + torch cu121
# -----------------------------------------------------------------------------
log "[3/6] conda env '${ENV_NAME}' (python 3.10)"
if conda env list | grep -qE "^${ENV_NAME}[[:space:]]"; then
    echo "env '${ENV_NAME}' already exists — reusing"
else
    conda create -y -n "${ENV_NAME}" python=3.10
fi
conda activate "${ENV_NAME}"
python -c "import sys; assert sys.version_info[:2]==(3,10), sys.version" \
    || die "wrong python in env"

log "    torch (cu121 wheels)"
if python -c "import torch" >/dev/null 2>&1; then
    echo "torch already installed: $(python -c 'import torch; print(torch.__version__)')"
else
    # Pinned to a version pair known-good with both VGGT and nerfstudio.
    # VERIFY on GPU box: torch 2.1.2+cu121 is the nerfstudio-recommended pin;
    # if VGGT's requirements want newer, let pip resolve and re-check CUDA.
    pip install torch==2.1.2 torchvision==0.16.2 --index-url https://download.pytorch.org/whl/cu121
fi
python -c "import torch; assert torch.cuda.is_available(), 'CUDA NOT AVAILABLE'" \
    || die "torch installed but torch.cuda.is_available() is False"
echo "torch sees GPU: $(python -c 'import torch; print(torch.cuda.get_device_name(0))')"

# -----------------------------------------------------------------------------
# 4. VGGT (feed-forward pose estimation — the fast path)
# -----------------------------------------------------------------------------
log "[4/6] VGGT (facebookresearch/vggt)"
if [ -d "${VGGT_DIR}/.git" ]; then
    echo "vggt already cloned at ${VGGT_DIR}"
else
    git clone https://github.com/facebookresearch/vggt.git "${VGGT_DIR}"
fi
pip install -e "${VGGT_DIR}"
# demo_colmap.py has extra deps (pycolmap for BA etc.)
# VERIFY on GPU box: requirements file names per the repo README.
if [ -f "${VGGT_DIR}/requirements.txt" ]; then pip install -r "${VGGT_DIR}/requirements.txt"; fi
if [ -f "${VGGT_DIR}/requirements_demo.txt" ]; then pip install -r "${VGGT_DIR}/requirements_demo.txt"; fi
[ -f "${VGGT_DIR}/demo_colmap.py" ] || echo "WARN: ${VGGT_DIR}/demo_colmap.py not found — reconstruct.py will fall back to COLMAP"

# -----------------------------------------------------------------------------
# 5. gsplat + nerfstudio (training + COLMAP fallback path) + gateway server deps
# -----------------------------------------------------------------------------
log "[5/6] gsplat + nerfstudio + fastapi"
# gsplat compiles CUDA kernels on first import; installing it explicitly
# pins the rasterizer nerfstudio's splatfacto uses.
pip install gsplat
pip install nerfstudio
pip install fastapi uvicorn python-multipart
command -v ns-train >/dev/null 2>&1 || die "ns-train not on PATH after nerfstudio install"
command -v ns-process-data >/dev/null 2>&1 || die "ns-process-data not on PATH"
command -v ns-export >/dev/null 2>&1 || die "ns-export not on PATH"

# -----------------------------------------------------------------------------
# 6. Gateway working dirs
# -----------------------------------------------------------------------------
log "[6/6] gateway dirs"
mkdir -p "${GATEWAY_DIR}/jobs" "${GATEWAY_DIR}/scenes"

echo
echo "Activate with:  conda activate ${ENV_NAME}"
echo "Run gateway:    cd ${GATEWAY_DIR} && uvicorn server:app --host 0.0.0.0 --port 8000"
echo
echo "SETUP OK"
