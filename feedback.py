"""Feedback rating and prompt improvement pipeline."""

import json
import base64
import os
from datetime import datetime, timezone
from pathlib import Path

from retouch import PROMPTS, _get_client

UPLOAD_DIR = Path(__file__).parent / "uploads"
OVERRIDES_PATH = Path(__file__).parent / "prompt_overrides.json"

BAD_THRESHOLD = 5
BAD_RATIO = 0.6
MAX_PAIRS = 3

REFUSAL_PHRASES = ["i can't", "i cannot", "i'm unable", "as an ai"]


def save_rating(job_id: str, rating: str) -> dict:
    """Write rating.json into uploads/{job_id}/."""
    job_dir = UPLOAD_DIR / job_id
    if not job_dir.exists():
        raise FileNotFoundError(f"Job {job_id} not found")

    intensity_file = job_dir / "intensity.txt"
    intensity = intensity_file.read_text().strip() if intensity_file.exists() else "medium"

    version_file = job_dir / "prompt_version.txt"
    prompt_version = int(version_file.read_text().strip()) if version_file.exists() else 1

    record = {
        "job_id": job_id,
        "intensity": intensity,
        "rating": rating,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "prompt_version": prompt_version,
    }
    (job_dir / "rating.json").write_text(json.dumps(record, indent=2))
    return record


def load_all_ratings() -> list[dict]:
    """Read all rating.json files across jobs."""
    ratings = []
    if not UPLOAD_DIR.exists():
        return ratings
    for rating_file in UPLOAD_DIR.glob("*/rating.json"):
        try:
            ratings.append(json.loads(rating_file.read_text()))
        except (json.JSONDecodeError, OSError):
            continue
    return ratings


def get_current_prompt_version() -> int:
    """Read version from prompt_overrides.json (default 1)."""
    if not OVERRIDES_PATH.exists():
        return 1
    try:
        data = json.loads(OVERRIDES_PATH.read_text())
        return data.get("version", 1)
    except (json.JSONDecodeError, OSError):
        return 1


def get_active_prompt(intensity: str) -> str:
    """Return override prompt if exists, else hardcoded default."""
    default = PROMPTS.get(intensity, PROMPTS["medium"])
    if not OVERRIDES_PATH.exists():
        return default
    try:
        data = json.loads(OVERRIDES_PATH.read_text())
        override = data.get("prompts", {}).get(intensity)
        return override if override else default
    except (json.JSONDecodeError, OSError):
        return default


def get_feedback_stats() -> dict:
    """Return good/bad counts per intensity."""
    ratings = load_all_ratings()
    stats = {}
    for r in ratings:
        intensity = r.get("intensity", "unknown")
        if intensity not in stats:
            stats[intensity] = {"good": 0, "bad": 0}
        if r.get("rating") == "good":
            stats[intensity]["good"] += 1
        elif r.get("rating") == "bad":
            stats[intensity]["bad"] += 1
    return stats


def check_and_trigger_analysis() -> dict | None:
    """Scan ratings and trigger analysis if threshold met. Returns result or None."""
    ratings = load_all_ratings()
    current_version = get_current_prompt_version()

    # Group by intensity+version
    groups: dict[str, list[dict]] = {}
    for r in ratings:
        key = f"{r.get('intensity')}:v{r.get('prompt_version', 1)}"
        groups.setdefault(key, []).append(r)

    for key, group in groups.items():
        intensity, version_str = key.split(":")
        version = int(version_str[1:])

        # Skip if already upgraded past this version
        if version < current_version:
            continue

        bad = [r for r in group if r.get("rating") == "bad"]
        good = [r for r in group if r.get("rating") == "good"]
        total = len(bad) + len(good)

        if len(bad) < BAD_THRESHOLD:
            continue
        if total > 0 and len(bad) / total < BAD_RATIO:
            continue

        # Threshold met — analyze
        bad_job_ids = [r["job_id"] for r in bad[:MAX_PAIRS]]
        result = _analyze_failures(intensity, bad_job_ids)
        if result:
            return result

    return None


def _analyze_failures(intensity: str, bad_job_ids: list[str]) -> dict | None:
    """Send before/after pairs to Gemini as critic, return improved prompt."""
    current_prompt = get_active_prompt(intensity)

    # Build content parts for Gemini
    content_parts = [
        (
            f"You are a prompt engineering critic for portrait retouching.\n\n"
            f"The current prompt for '{intensity}' retouching is:\n"
            f'"{current_prompt}"\n\n'
            f"Below are before/after image pairs where users rated the result as BAD.\n"
            f"Analyze what went wrong and write an improved prompt that would produce "
            f"better results. The prompt must:\n"
            f"- Stay focused on {intensity}-level retouching\n"
            f"- Not alter face shape, eye color, bone structure, or hair\n"
            f"- Keep the person recognizable\n"
            f"- Be a single paragraph, no longer than 3 sentences\n\n"
            f"Respond with ONLY the improved prompt text, nothing else."
        )
    ]

    pairs_found = 0
    for job_id in bad_job_ids:
        job_dir = UPLOAD_DIR / job_id
        before = job_dir / "cropped_square.jpg"
        after = job_dir / "retouched.jpg"
        if before.exists() and after.exists():
            content_parts.append(f"\n--- Pair {pairs_found + 1} ---\nBefore:")
            content_parts.append(_load_image_for_gemini(before))
            content_parts.append("After (rated BAD):")
            content_parts.append(_load_image_for_gemini(after))
            pairs_found += 1

    if pairs_found == 0:
        return None

    try:
        client = _get_client()
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=content_parts,
        )
        new_prompt = response.text.strip().strip('"').strip("'")

        # Validate
        if len(new_prompt) < 30:
            return None
        if any(phrase in new_prompt.lower() for phrase in REFUSAL_PHRASES):
            return None

        return _save_override(intensity, new_prompt, bad_job_ids)
    except Exception as e:
        print(f"[feedback] Analysis failed: {e}")
        return None


def _load_image_for_gemini(path: Path):
    """Load image file for Gemini API content."""
    from PIL import Image
    return Image.open(path).convert("RGB")


def _save_override(intensity: str, new_prompt: str, trigger_jobs: list[str]) -> dict:
    """Write prompt_overrides.json with version bump."""
    if OVERRIDES_PATH.exists():
        try:
            data = json.loads(OVERRIDES_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            data = {}
    else:
        data = {}

    prompts = data.get("prompts", {"light": None, "medium": None, "strong": None})
    history = data.get("history", [])
    version = data.get("version", 1) + 1

    old_prompt = prompts.get(intensity)
    prompts[intensity] = new_prompt

    history.append({
        "version": version,
        "intensity": intensity,
        "old_prompt": old_prompt,
        "new_prompt": new_prompt,
        "trigger_jobs": trigger_jobs,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    data = {
        "version": version,
        "prompts": prompts,
        "history": history,
    }
    OVERRIDES_PATH.write_text(json.dumps(data, indent=2))
    print(f"[feedback] Prompt override saved for '{intensity}' (v{version})")
    return {"intensity": intensity, "version": version, "new_prompt": new_prompt}
