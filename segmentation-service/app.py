"""
FastAPI service for the segmentation pipeline.

Run with:  uvicorn app:app --port 8000
(or:       python app.py  — which starts uvicorn programmatically)

Endpoints:
    GET  /health    - Check if model is loaded and GPU is available
    POST /segment   - Run segmentation on a folder of medical images

Note: this HTTP service is optional. The Node backend currently spawns the
Python scripts directly via child_process; this API is here for deployments
that prefer a long-lived inference service (keeps the model warm in memory).
"""

import os
import sys
import json
import asyncio

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Onco Cure Vision — Segmentation Service", version="2.0.0")

_HERE = os.path.dirname(os.path.abspath(__file__))
PREDICT_SCRIPT = os.path.join(_HERE, "predict_segmentation.py")
SEGMENT_TIMEOUT = 600  # seconds (10 min)


class SegmentRequest(BaseModel):
    input_folder: str


@app.get("/health")
def health():
    """Check service health and model availability."""
    import torch
    model_path = os.path.join(_HERE, "models", "best_model.pth")
    return {
        "status": "ok",
        "model_available": os.path.exists(model_path),
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }


@app.post("/segment")
async def segment(req: SegmentRequest):
    """Run the segmentation pipeline on an input folder."""
    input_folder = req.input_folder
    if not input_folder or not os.path.isdir(input_folder):
        raise HTTPException(status_code=400, detail="Invalid input folder")

    # Run predict_segmentation.py as a subprocess (keeps memory isolated per run).
    proc = await asyncio.create_subprocess_exec(
        sys.executable, PREDICT_SCRIPT, input_folder,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=SEGMENT_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        raise HTTPException(status_code=504, detail="Segmentation timed out (10 min limit)")

    if proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"Segmentation failed: {stderr.decode(errors='replace')}",
        )

    # Parse the last valid JSON line from stdout.
    prediction_result = None
    for line in stdout.decode(errors="replace").strip().splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                prediction_result = json.loads(line)
            except json.JSONDecodeError:
                continue

    if not prediction_result or not prediction_result.get("success"):
        raise HTTPException(status_code=500, detail="Segmentation produced no valid output")

    return prediction_result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
