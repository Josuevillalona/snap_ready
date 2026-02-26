"""Gemini 3 Pro Image retouch wrapper."""

import os

from google import genai
from google.genai import types
from PIL import Image
import io

_CLIENT = None

SAFETY_SUFFIX = (
    " Do not alter face shape, eye color, bone structure, or hair."
    " The person must be immediately recognizable as themselves."
)

PROMPTS = {
    "light": (
        "Very subtle retouching only: minimize visible blemishes,"
        " keep all skin texture and character intact."
        " Natural, barely-edited look." + SAFETY_SUFFIX
    ),
    "medium": (
        "Conservative portrait retouching: smooth minor skin blemishes,"
        " even out skin tone slightly, reduce under-eye shadows."
        " Keep all facial features exactly the same." + SAFETY_SUFFIX
    ),
    "strong": (
        "Professional portrait retouching: smooth skin, even out complexion,"
        " reduce wrinkles and blemishes, brighten eyes slightly."
        " Maintain recognizable likeness and natural appearance." + SAFETY_SUFFIX
    ),
}


def _get_client():
    global _CLIENT
    if _CLIENT is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY environment variable is not set")
        _CLIENT = genai.Client(api_key=api_key)
    return _CLIENT


def _detect_resolution(pil_image: Image.Image) -> str:
    """Pick output resolution based on input image dimensions."""
    w, h = pil_image.size
    max_dim = max(w, h)
    if max_dim >= 3000:
        return "4K"
    elif max_dim >= 1500:
        return "2K"
    return "1K"


def retouch_image(pil_image: Image.Image, intensity: str = "medium") -> Image.Image:
    """Send image to Gemini for retouching and return the result."""
    client = _get_client()
    prompt = PROMPTS.get(intensity, PROMPTS["medium"])
    resolution = _detect_resolution(pil_image)

    # Map resolution string to SDK enum
    size_map = {
        "1K": "IMAGE_SIZE_1024x1024",
        "2K": "IMAGE_SIZE_2048x2048",
        "4K": "IMAGE_SIZE_4096x4096",
    }
    image_size = size_map.get(resolution, "IMAGE_SIZE_1024x1024")

    response = client.models.generate_content(
        model="gemini-3-pro-image-preview",
        contents=[pil_image, prompt],
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            response_mime_type="image/jpeg",
        ),
    )

    # Extract image from response
    for part in response.candidates[0].content.parts:
        if part.inline_data is not None:
            image_bytes = part.inline_data.data
            result = Image.open(io.BytesIO(image_bytes))
            if result.mode == "RGBA":
                result = result.convert("RGB")
            return result

    raise RuntimeError("Gemini API did not return an image")
