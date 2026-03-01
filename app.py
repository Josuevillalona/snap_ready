"""SnapReady MVP — FastAPI application."""

import uuid
from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()

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
import urllib.request
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, auth, firestore, storage
import fastapi
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

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

# --- Firebase Initialization ---
firebase_cred_path = Path(__file__).parent / "yphoto-firebase-adminsdk.json"
if not firebase_cred_path.exists():
    print("WARNING: Firebase Admin SDK JSON not found. Auth will fail.")

cred = credentials.Certificate(str(firebase_cred_path))
firebase_app = firebase_admin.initialize_app(cred, {
    'storageBucket': 'yphoto-d4f64.firebasestorage.app'
})

db = firestore.client()
bucket = storage.bucket()
security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = fastapi.Depends(security)):
    """FastAPI Dependency to verify Firebase Auth Tokens"""
    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token['uid']
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid authentication token: {e}")

# Job state tracking (In-memory for MVP, ideally Redis/DB in production)
# We will still use this for fast polling, but source of truth is Firestore
JOB_STATUSES = {}

def upload_to_firebase(file_path: Path, destination_path: str) -> str:
    """Uploads a file to Firebase Storage and returns the public URL."""
    blob = bucket.blob(destination_path)
    blob.upload_from_filename(str(file_path))
    blob.make_public()
    return blob.public_url

def async_process_job(job_id: str, intensity: str, pil_image: Image.Image, face: dict, job_dir: Path, zoom: float, user_id: str):
    """Background task to crop, retouch, upload to Firebase, and update Firestore."""
    JOB_STATUSES[job_id] = "processing"
    
    # 1. Update Firestore status
    doc_ref = db.collection('users').document(user_id).collection('jobs').document(job_id)
    doc_ref.set({
        'job_id': job_id,
        'status': 'processing',
        'intensity': intensity,
        'zoom': zoom,
        'created_at': datetime.utcnow(),
    }, merge=True)
    
    try:
        # Crop with zoom
        cropped = crop_headshot_square(pil_image, face, zoom=zoom)
        cropped_path = job_dir / "cropped_square.jpg"
        cropped.save(cropped_path, "JPEG", quality=95)
        
        # Retouch
        retouched = retouch_image(cropped, intensity)
        retouched_path = job_dir / "retouched.jpg"
        retouched.save(retouched_path, "JPEG", quality=95)
        
        # Upload to Firebase Storage
        original_url = upload_to_firebase(job_dir / "original.jpg", f"users/{user_id}/{job_id}/original.jpg")
        cropped_url = upload_to_firebase(cropped_path, f"users/{user_id}/{job_id}/cropped.jpg")
        retouched_url = upload_to_firebase(retouched_path, f"users/{user_id}/{job_id}/retouched.jpg")

        # Save face coordinates to Firestore instead of a text file
        face_data = {"x": face['x'], "y": face['y'], "w": face['w'], "h": face['h']}

        # Update Firestore with completion data
        doc_ref.update({
            'status': 'completed',
            'original_url': original_url,
            'cropped_url': cropped_url,
            'retouched_url': retouched_url,
            'face': face_data,
            'prompt_version': get_current_prompt_version()
        })
        
        JOB_STATUSES[job_id] = "completed"
    except Exception as e:
        print(f"Job {job_id} failed: {e}")
        JOB_STATUSES[job_id] = "failed"
        doc_ref.update({
            'status': 'failed',
            'error': str(e)
        })
        (job_dir / "error.txt").write_text(str(e))


@app.post("/process")
async def process_photo(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    intensity: str = Form("medium"),
    zoom: float = Form(1.0),
    user_id: str = fastapi.Depends(verify_token)
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
    
    # Save locally temporarily for background worker
    pil_image.save(job_dir / "original.jpg", "JPEG", quality=95)

    # Queue background processing
    background_tasks.add_task(async_process_job, job_id, intensity, pil_image, face, job_dir, zoom, user_id)

    return JSONResponse({"job_id": job_id, "status": "processing"})


@app.get("/status/{job_id}")
async def check_status(job_id: str, user_id: str = fastapi.Depends(verify_token)):
    # 1. Check fast memory cache first
    status = JOB_STATUSES.get(job_id)
    retouched_url = None
    cropped_url = None

    # 2. Check Firestore as source of truth
    doc_ref = db.collection('users').document(user_id).collection('jobs').document(job_id)
    doc = doc_ref.get()
    
    if doc.exists:
        data = doc.to_dict()
        status = data.get('status', 'unknown')
        retouched_url = data.get('retouched_url')
        cropped_url = data.get('cropped_url')
    elif not status:
        raise HTTPException(404, "Job not found.")
            
    return JSONResponse({
        "job_id": job_id, 
        "status": status,
        "retouched_url": retouched_url,
        "cropped_url": cropped_url,
        "intensity": data.get('intensity', 'medium') if doc.exists else 'medium',
        "zoom": data.get('zoom', 1.0) if doc.exists else 1.0,
        "error": data.get('error') if doc.exists and status == "failed" else None
    })

@app.get("/jobs")
async def get_user_jobs(user_id: str = fastapi.Depends(verify_token)):
    """Fetch all completed jobs for a user's gallery."""
    jobs_ref = db.collection('users').document(user_id).collection('jobs')
    query = jobs_ref.order_by('created_at', direction=firestore.Query.DESCENDING).limit(20)
    
    jobs = []
    for doc in query.stream():
        data = doc.to_dict()
        if data.get('status') == 'completed':
            jobs.append({
                "job_id": data['job_id'],
                "retouched_url": data.get('retouched_url'),
                "cropped_url": data.get('cropped_url'),
                "intensity": data.get('intensity'),
                "zoom": data.get('zoom')
            })
    
    return JSONResponse({"jobs": jobs})

@app.delete("/jobs/{job_id}")
async def delete_job(job_id: str, user_id: str = fastapi.Depends(verify_token)):
    """Delete a job and its associated files from Firebase Storage."""
    doc_ref = db.collection('users').document(user_id).collection('jobs').document(job_id)
    doc = doc_ref.get()
    
    if not doc.exists:
        raise HTTPException(404, "Job not found.")
    
    # Delete files from Firebase Storage
    prefix = f"users/{user_id}/{job_id}/"
    blobs = bucket.list_blobs(prefix=prefix)
    for blob in blobs:
        try:
            blob.delete()
        except Exception:
            pass  # Best-effort deletion
    
    # Delete Firestore document
    doc_ref.delete()
    
    return JSONResponse({"status": "deleted", "job_id": job_id})

@app.post("/reprocess/{job_id}")
async def reprocess(
    job_id: str, 
    background_tasks: BackgroundTasks,
    intensity: str = Form("medium"),
    zoom: float = Form(1.0),
    user_id: str = fastapi.Depends(verify_token)
):
    doc_ref = db.collection('users').document(user_id).collection('jobs').document(job_id)
    doc = doc_ref.get()
    
    if not doc.exists:
        raise HTTPException(404, "Job not found.")
        
    data = doc.to_dict()
    original_url = data.get('original_url')
    face = data.get('face')

    if not original_url or not face:
        raise HTTPException(404, "Original image or face data missing, cannot reprocess.")

    intensity = intensity.lower()
    if intensity not in ("light", "medium", "strong"):
        intensity = "medium"

    # Download original image back from Firebase Storage to memory
    try:
        req = urllib.request.Request(original_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            image_data = response.read()
        pil_image = Image.open(io.BytesIO(image_data)).convert("RGB")
    except Exception as e:
        raise HTTPException(500, f"Could not download original image for reprocessing: {e}")

    # Set up temp dir for background worker
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    # Keep the local copy of original so the worker can use it
    pil_image.save(job_dir / "original.jpg", "JPEG", quality=95)

    # Queue background reprocessing
    background_tasks.add_task(async_process_job, job_id, intensity, pil_image, face, job_dir, zoom, user_id)

    return JSONResponse({"job_id": job_id, "status": "processing"})





@app.get("/download/{job_id}")
async def download_zip(job_id: str, user_id: str = fastapi.Depends(verify_token)):
    doc_ref = db.collection('users').document(user_id).collection('jobs').document(job_id)
    doc = doc_ref.get()
    
    if not doc.exists:
        raise HTTPException(404, "Job not found.")
        
    data = doc.to_dict()
    retouched_url = data.get('retouched_url')
    if not retouched_url:
        raise HTTPException(404, "Retouched image not found.")

    # Download from Firebase to memory
    try:
        req = urllib.request.Request(retouched_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            image_data = response.read()
        retouched = Image.open(io.BytesIO(image_data)).convert("RGB")
    except Exception as e:
        raise HTTPException(500, f"Could not download image: {e}")
        
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    zip_bytes = build_zip(retouched, job_id)

    zip_path = job_dir / f"{job_id}.zip"
    with open(zip_path, "wb") as f:
        f.write(zip_bytes.getvalue())

    return FileResponse(
        path=zip_path,
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
