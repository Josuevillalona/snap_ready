"""SnapReady MVP — FastAPI application."""

import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import io

from crop import detect_face, crop_headshot_square
from retouch import retouch_image
from export import build_zip
from feedback import (
    save_rating, get_feedback_stats, get_current_prompt_version,
    check_and_trigger_analysis,
)
import asyncio

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB
ALLOWED_TYPES = {"image/jpeg", "image/png"}

app = FastAPI(title="SnapReady API")

# Configure CORS
origins = [
    "http://localhost:3000",             # Local development frontend
    "https://snapready.vercel.app",      # Vercel preview/production (Update with actual Vercel domain later)
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all for now during MVP testing to prevent issues. Restrict later.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# Job state tracking (In-memory for MVP, ideally Redis/DB in production)
JOB_STATUSES = {}

def async_process_job(job_id: str, intensity: str, pil_image: Image.Image, face: dict, job_dir: Path, zoom: float = 1.0):
    """Background task to crop, retouch, and update status."""
    JOB_STATUSES[job_id] = "processing"
    
    try:
        # Crop with zoom
        cropped = crop_headshot_square(pil_image, face, zoom=zoom)
        cropped.save(job_dir / "cropped_square.jpg", "JPEG", quality=95)
        
        # Retouch
        retouched = retouch_image(cropped, intensity)
        retouched.save(job_dir / "retouched.jpg", "JPEG", quality=95)
        
        JOB_STATUSES[job_id] = "completed"
    except Exception as e:
        print(f"Job {job_id} failed: {e}")
        JOB_STATUSES[job_id] = "failed"
        (job_dir / "error.txt").write_text(str(e))


@app.post("/process")
async def process_photo(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    intensity: str = Form("medium"),
    zoom: float = Form(1.0),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Only JPG and PNG files are accepted.")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "File exceeds 20 MB limit.")

    try:
        pil_image = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not read image file.")

    face = detect_face(pil_image)
    if face is None:
        raise HTTPException(422, "No face detected in the photo. Try a different image.")

    intensity = intensity.lower()
    if intensity not in ("light", "medium", "strong"):
        intensity = "medium"

    # Setup directories
    job_id = uuid.uuid4().hex[:12]
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    pil_image.save(job_dir / "original.jpg", "JPEG", quality=95)
    (job_dir / "intensity.txt").write_text(intensity)
    (job_dir / "prompt_version.txt").write_text(str(get_current_prompt_version()))
    
    # Save face coordinate metadata so we don't have to re-detect it on reprocess
    face_data = f"{face['x']},{face['y']},{face['w']},{face['h']}"
    (job_dir / "face.txt").write_text(face_data)

    # Queue background processing
    background_tasks.add_task(async_process_job, job_id, intensity, pil_image, face, job_dir, zoom)

    return JSONResponse({"job_id": job_id, "status": "processing"})


@app.get("/status/{job_id}")
async def check_status(job_id: str):
    job_dir = UPLOAD_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(404, "Job not found.")
        
    status = JOB_STATUSES.get(job_id)
    if not status:
        # Fallback if server restarted but files exist
        if (job_dir / "retouched.jpg").exists():
            status = "completed"
        elif (job_dir / "error.txt").exists():
            status = "failed"
        else:
            status = "unknown"
            
    return JSONResponse({
        "job_id": job_id, 
        "status": status,
        "error": (job_dir / "error.txt").read_text() if status == "failed" else None
    })


@app.post("/reprocess/{job_id}")
async def reprocess(
    job_id: str, 
    background_tasks: BackgroundTasks,
    intensity: str = Form("medium"),
    zoom: float = Form(1.0),
):
    job_dir = UPLOAD_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(404, "Job not found.")

    intensity = intensity.lower()
    if intensity not in ("light", "medium", "strong"):
        intensity = "medium"

    original_path = job_dir / "original.jpg"
    face_path = job_dir / "face.txt"
    
    if not original_path.exists() or not face_path.exists():
        raise HTTPException(404, "Original image or face data missing, cannot reprocess.")

    pil_image = Image.open(original_path).convert("RGB")
    
    # Reload face coordinates
    face_str = face_path.read_text().split(",")
    face = {
        "x": float(face_str[0]),
        "y": float(face_str[1]),
        "w": float(face_str[2]),
        "h": float(face_str[3])
    }

    (job_dir / "intensity.txt").write_text(intensity)
    (job_dir / "prompt_version.txt").write_text(str(get_current_prompt_version()))

    # Queue background reprocessing
    background_tasks.add_task(async_process_job, job_id, intensity, pil_image, face, job_dir, zoom)

    return JSONResponse({"job_id": job_id, "status": "processing"})





@app.get("/download/{job_id}")
async def download_zip(job_id: str):
    job_dir = UPLOAD_DIR / job_id
    retouched_path = job_dir / "retouched.jpg"
    if not retouched_path.exists():
        raise HTTPException(404, "Job not found.")

    retouched = Image.open(retouched_path).convert("RGB")
    zip_bytes = build_zip(retouched, job_id)

    zip_path = job_dir / f"{job_id}.zip"
    zip_path.write_bytes(zip_bytes)

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"snapready_{job_id}.zip",
    )


@app.post("/rate/{job_id}")
async def rate_job(job_id: str, rating: str = Form(...), background_tasks: BackgroundTasks = None):
    if rating not in ("good", "bad"):
        raise HTTPException(400, "Rating must be 'good' or 'bad'.")
    job_dir = UPLOAD_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(404, "Job not found.")

    record = save_rating(job_id, rating)
    if background_tasks:
        background_tasks.add_task(check_and_trigger_analysis)
    return JSONResponse(record)


@app.get("/feedback/stats")
async def feedback_stats():
    return JSONResponse(get_feedback_stats())


@app.post("/feedback/analyze")
async def manual_analyze():
    result = check_and_trigger_analysis()
    if result is None:
        return JSONResponse({"status": "no_action", "message": "Threshold not met or no improvements needed."})
    return JSONResponse({"status": "updated", **result})
