"""
UniMERNet OCR Server
Converts math equation images to LaTeX via FastAPI.
"""

import argparse
import base64
import io
import time
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

from unimernet.common.config import Config
import unimernet.tasks as tasks
from unimernet.processors import load_processor

# ---------------------------------------------------------------------------
# Globals (populated on startup)
# ---------------------------------------------------------------------------
model = None
vis_processor = None
device = None


def load_model():
    global model, vis_processor, device

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[ocr-server] Loading UniMERNet on {device}...")

    cfg_path = "/app/config.yaml"
    args = argparse.Namespace(cfg_path=cfg_path, options=None)
    cfg = Config(args)
    task = tasks.setup_task(cfg)
    model = task.build_model(cfg).to(device)
    model.eval()

    vis_processor = load_processor(
        "formula_image_eval",
        cfg.config.datasets.formula_rec_eval.vis_processor.eval,
    )
    print("[ocr-server] UniMERNet loaded successfully.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield


app = FastAPI(title="Redou OCR Server", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------
class EquationRequest(BaseModel):
    """Single equation image."""
    image: str  # base64-encoded PNG/JPEG


class BatchEquationRequest(BaseModel):
    """Batch of equation images."""
    images: list[str]  # list of base64-encoded PNG/JPEG


class EquationResponse(BaseModel):
    latex: str
    elapsed_ms: float


class BatchEquationResponse(BaseModel):
    results: list[str]  # list of LaTeX strings
    count: int
    elapsed_ms: float


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def decode_image(b64: str) -> Image.Image:
    """Decode a base64 string to a PIL Image."""
    raw = base64.b64decode(b64)
    return Image.open(io.BytesIO(raw)).convert("RGB")


@torch.no_grad()
def predict_batch(images: list[Image.Image]) -> list[str]:
    """Run UniMERNet on a batch of PIL images, return LaTeX strings."""
    tensors = torch.stack([vis_processor(img) for img in images]).to(device)
    output = model.generate({"image": tensors})
    return output["pred_str"]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "unimernet_base",
        "device": str(device),
        "cuda": torch.cuda.is_available(),
    }


@app.post("/predict", response_model=EquationResponse)
def predict_single(req: EquationRequest):
    """Convert a single equation image to LaTeX."""
    if model is None:
        raise HTTPException(503, "Model not loaded yet")

    t0 = time.perf_counter()
    img = decode_image(req.image)
    results = predict_batch([img])
    elapsed = (time.perf_counter() - t0) * 1000

    return EquationResponse(latex=results[0], elapsed_ms=round(elapsed, 1))


@app.post("/predict/batch", response_model=BatchEquationResponse)
def predict_multi(req: BatchEquationRequest):
    """Convert multiple equation images to LaTeX in one call."""
    if model is None:
        raise HTTPException(503, "Model not loaded yet")
    if len(req.images) == 0:
        return BatchEquationResponse(results=[], count=0, elapsed_ms=0)
    if len(req.images) > 64:
        raise HTTPException(400, "Maximum 64 images per batch")

    t0 = time.perf_counter()
    imgs = [decode_image(b64) for b64 in req.images]
    results = predict_batch(imgs)
    elapsed = (time.perf_counter() - t0) * 1000

    return BatchEquationResponse(
        results=results,
        count=len(results),
        elapsed_ms=round(elapsed, 1),
    )
