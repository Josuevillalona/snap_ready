"""Face detection and headshot cropping using MediaPipe."""

from pathlib import Path

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import FaceDetector, FaceDetectorOptions
from PIL import Image
import numpy as np

_MODEL_PATH = str(Path(__file__).parent / "models" / "blaze_face_short_range.tflite")

_options = FaceDetectorOptions(
    base_options=BaseOptions(model_asset_path=_MODEL_PATH),
    min_detection_confidence=0.5,
)
_detector = FaceDetector.create_from_options(_options)


def detect_face(pil_image: Image.Image) -> dict | None:
    """Detect the most prominent face and return {x, y, w, h} in pixels, or None."""
    img_array = np.array(pil_image.convert("RGB"))
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_array)
    result = _detector.detect(mp_image)

    if not result.detections:
        return None

    detection = result.detections[0]
    bbox = detection.bounding_box
    return {
        "x": bbox.origin_x,
        "y": bbox.origin_y,
        "w": bbox.width,
        "h": bbox.height,
    }


def _crop_centered(
    pil_image: Image.Image,
    face: dict,
    target_w: int,
    target_h: int,
    pad_top: float,
    pad_bottom: float,
    pad_left: float,
    pad_right: float,
) -> Image.Image:
    """Crop an image centered on a face with specified padding ratios and output size."""
    img_w, img_h = pil_image.size
    fx, fy, fw, fh = face["x"], face["y"], face["w"], face["h"]

    # Face center
    cx = fx + fw / 2
    cy = fy + fh / 2

    # Desired crop region based on face size and padding
    crop_top = cy - fh * pad_top
    crop_bottom = cy + fh * pad_bottom
    crop_h = crop_bottom - crop_top

    # Derive width from height to match aspect ratio
    aspect = target_w / target_h
    crop_w = crop_h * aspect

    crop_left = cx - crop_w / 2
    crop_right = cx + crop_w / 2

    # Ensure minimum side padding
    min_side_pad = fw * pad_left
    if cx - crop_left < min_side_pad:
        crop_w = max(crop_w, (min_side_pad + fw / 2) * 2)
        crop_left = cx - crop_w / 2
        crop_right = cx + crop_w / 2

    # Clamp to image bounds, shifting if needed
    if crop_left < 0:
        crop_right -= crop_left
        crop_left = 0
    if crop_right > img_w:
        crop_left -= crop_right - img_w
        crop_right = img_w
    if crop_top < 0:
        crop_bottom -= crop_top
        crop_top = 0
    if crop_bottom > img_h:
        crop_top -= crop_bottom - img_h
        crop_bottom = img_h

    crop_left = max(0, int(crop_left))
    crop_top = max(0, int(crop_top))
    crop_right = min(img_w, int(crop_right))
    crop_bottom = min(img_h, int(crop_bottom))

    cropped = pil_image.crop((crop_left, crop_top, crop_right, crop_bottom))
    return cropped.resize((target_w, target_h), Image.LANCZOS)


def crop_headshot_square(pil_image: Image.Image, face: dict, zoom: float = 1.0) -> Image.Image:
    """Crop to 1200x1200 square centered on face. Zoom > 1 is wider, < 1 is tighter."""
    # Base paddings (zoom=1.0) - Increased for a wider default crop
    base_top, base_bottom = 0.95, 0.85
    base_left, base_right = 0.85, 0.85

    return _crop_centered(
        pil_image, face,
        target_w=1200, target_h=1200,
        pad_top=base_top * zoom, 
        pad_bottom=base_bottom * zoom,
        pad_left=base_left * zoom, 
        pad_right=base_right * zoom,
    )


def crop_headshot_portrait(pil_image: Image.Image, face: dict) -> Image.Image:
    """Crop to 960x1200 (4:5) portrait centered on face with shoulder room."""
    return _crop_centered(
        pil_image, face,
        target_w=960, target_h=1200,
        pad_top=0.55, pad_bottom=1.40,
        pad_left=0.60, pad_right=0.60,
    )
