"""SnapReady MVP — FastAPI application."""

import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import io

from crop import detect_face, crop_headshot_square
from retouch import retouch_image
from export import build_zip

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


@app.post("/process")
async def process_photo(
    file: UploadFile = File(...),
    intensity: str = Form("medium"),
):
    # Validate file type
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Only JPG and PNG files are accepted.")

    # Read and validate size
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "File exceeds 20 MB limit.")

    # Open image
    try:
        pil_image = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not read image file.")

    # Detect face
    face = detect_face(pil_image)
    if face is None:
        raise HTTPException(422, "No face detected in the photo. Try a different image.")

    # Crop
    cropped = crop_headshot_square(pil_image, face)

    # Retouch
    intensity = intensity.lower()
    if intensity not in ("light", "medium", "strong"):
        intensity = "medium"

    try:
        retouched = retouch_image(cropped, intensity)
    except Exception as e:
        raise HTTPException(502, f"Retouch failed: {e}")

    # Save job files
    job_id = uuid.uuid4().hex[:12]
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    pil_image.save(job_dir / "original.jpg", "JPEG", quality=95)
    cropped.save(job_dir / "cropped_square.jpg", "JPEG", quality=95)
    retouched.save(job_dir / "retouched.jpg", "JPEG", quality=95)

    # Save intensity for display
    (job_dir / "intensity.txt").write_text(intensity)

    return JSONResponse({"job_id": job_id})


@app.post("/reprocess/{job_id}")
async def reprocess(job_id: str, intensity: str = Form("medium")):
    job_dir = UPLOAD_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(404, "Job not found.")

    cropped_path = job_dir / "cropped_square.jpg"
    if not cropped_path.exists():
        raise HTTPException(404, "Cropped image not found.")

    cropped = Image.open(cropped_path).convert("RGB")

    intensity = intensity.lower()
    if intensity not in ("light", "medium", "strong"):
        intensity = "medium"

    try:
        retouched = retouch_image(cropped, intensity)
    except Exception as e:
        raise HTTPException(502, f"Retouch failed: {e}")

    retouched.save(job_dir / "retouched.jpg", "JPEG", quality=95)
    (job_dir / "intensity.txt").write_text(intensity)

    return JSONResponse({"job_id": job_id, "intensity": intensity})





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
