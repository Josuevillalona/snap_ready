# SnapReady MVP — Product Requirements Document v2

**One-click crop + retouch for solo headshot photographers**
v2.0 · February 2026 · Single-user web app

---

## 1. What This Is

A simple web app where a photographer uploads a headshot, clicks one button, and gets back a cropped and retouched file ready to deliver to clients. No sliders to learn, no presets to manage — upload, click, download.

---

## 2. The Problem

Solo headshot photographers spend 5–10 minutes per photo on mechanical post-processing (crop, retouch, export). At 15 photos/week that's 1.5–2.5 hours of repetitive work that doesn't require creative judgment. The task is predictable enough to automate: detect face → crop to standard composition → apply conservative skin retouch → export at delivery sizes.

---

## 3. MVP Definition

**In scope:**
- Single photo upload (JPG/PNG, up to 20 MB)
- Automatic face-detection crop to headshot composition
- Automatic conservative skin retouch (AI-assisted, single API call)
- Intensity slider: Light / Medium / Strong
- Download as two standard sizes (1×1 web square + 4×5 portrait)

**Out of scope (for now):**
- Batch processing
- User accounts / auth
- Custom crop ratios
- Manual editing tools
- Background replacement

**Success condition:** A photographer can go from raw upload to deliverable file in under 30 seconds, and the output is good enough to send to a client without further editing at least 70% of the time.

---

## 4. Architecture

### Simplified 3-Step Pipeline

```
Upload (JPG/PNG)
    │
    ▼
┌─────────────────────────┐
│  Step 1: Auto-Crop      │  MediaPipe face detection → crop to headshot
│  (local, free)          │  composition (1×1 and 4×5 frames)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Step 2: AI Retouch     │  Gemini 3 Pro Image (image-to-image)
│  (~$0.01–$0.04/photo)   │  Single API call with prompt-based control
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Step 3: Export          │  Pillow resizes to delivery dimensions
│  (local, free)          │  and packages as ZIP
└─────────────────────────┘
```

**Why this changed from v1:** The original architecture used Claude Vision to *analyze* the photo and output numeric parameters (brightness +5, smoothing 3, etc.), then Pillow applied those adjustments pixel-by-pixel. This was fragile — the LLM output needed parsing, the parameter space was unbounded, and Pillow's pixel-level adjustments couldn't match what a generative model does in a single pass. Gemini 3 Pro Image replaces that entire analyze-then-manipulate pipeline with one image-to-image call that takes a photo and a text prompt and returns a retouched photo.

---

## 5. AI Retouch Engine

### Primary: Gemini 3 Pro Image (via `nano-banana-pro` skill)

The retouch step sends the cropped headshot plus a text prompt to Gemini 3 Pro Image and receives a retouched image back. No intermediate parameter parsing. No pixel manipulation code.

**How it works:**

```bash
uv run ~/.claude/skills/nano-banana-pro/scripts/generate_image.py \
  --prompt "Apply conservative portrait retouching: smooth minor skin blemishes, even out skin tone slightly, reduce under-eye shadows. Keep all facial features, hair, and expression exactly the same. Do not alter face shape, eye color, or bone structure." \
  --input-image "cropped-headshot.jpg" \
  --filename "retouched-headshot.png" \
  --resolution 2K
```

**Intensity control via prompt variation:**

| Slider Setting | Prompt Modifier |
|---|---|
| **Light** | "Very subtle retouching only: minimize visible blemishes, keep all skin texture and character intact. Natural, barely-edited look." |
| **Medium** (default) | "Conservative portrait retouching: smooth minor skin blemishes, even out skin tone slightly, reduce under-eye shadows. Keep all facial features exactly the same." |
| **Strong** | "Professional portrait retouching: smooth skin, even out complexion, reduce wrinkles and blemishes, brighten eyes slightly. Maintain recognizable likeness and natural appearance." |

All prompts include the safety suffix: *"Do not alter face shape, eye color, bone structure, or hair. The person must be immediately recognizable as themselves."*

### Fallback: SeedEdit 3.0 (via `inference.sh`)

If Gemini produces unacceptable facial drift or is unavailable, SeedEdit 3.0 is available as a backup engine through the `product-photography` skill:

```bash
infsh app run bytedance/seededit-3-0-i2i --input '{
  "prompt": "apply subtle professional portrait retouching, smooth skin blemishes, keep facial features identical",
  "image": "cropped-headshot.jpg"
}'
```

### Why Not Claude Vision + Pillow (v1 approach)?

| | v1: Claude Vision + Pillow | v2: Gemini 3 Pro Image |
|---|---|---|
| **Pipeline complexity** | 3 steps (analyze → parse → apply) | 1 step (image in → image out) |
| **Output quality** | Limited to Pillow's filters (Gaussian blur, brightness/contrast) | Full generative model quality |
| **Failure modes** | JSON parsing errors, out-of-range values, filter artifacts | Single API call — works or doesn't |
| **Code to maintain** | ~200 lines of parameter parsing + Pillow manipulation | ~10 lines wrapping the API call |
| **Cost per photo** | ~$0.01–$0.03 (Claude API) | ~$0.01–$0.04 (Gemini API) |

---

## 6. User Flow

```
1. Photographer opens SnapReady in browser
2. Drags or selects a headshot photo (JPG/PNG)
3. Upload begins → progress indicator
4. Backend: MediaPipe detects face → crops to headshot composition
5. Backend: Sends cropped image + retouch prompt to Gemini 3 Pro Image
6. Backend: Receives retouched image → resizes to 1×1 and 4×5
7. (~5–15 seconds total processing time)
8. Browser shows before/after comparison (side by side or slider)
9. Photographer adjusts intensity slider if needed (Light / Medium / Strong)
   → Re-processes with updated prompt (adds ~5–10 seconds)
10. Clicks "Download" → gets ZIP with both sizes
```

**Changed from v1:** Processing time reduced from ~10–20 seconds to ~5–15 seconds (one API call instead of two). No separate "analyzing" step visible to the user.

---

## 7. Quality Bar

"Good enough" means: a photographer would send this to the client without opening Lightroom.

| Attribute | Acceptable | Not Acceptable |
|---|---|---|
| Skin smoothing | Reduced visible blemishes, even tone | Plastic/airbrushed look, visible artifacts |
| Eyes | Natural, no redness | Altered color, artificial brightening, different shape |
| Face shape | Identical to original | Any visible alteration to bone structure or proportions |
| Color grading | Neutral, matches original lighting | Shifted white balance, added color cast |
| Crop | Centered on face, standard headshot framing | Cut off forehead/chin, off-center |
| Resolution | Matches or exceeds input quality | Visible blur, compression artifacts, resolution loss |

### New Risk: Facial Feature Drift

Generative image-to-image models can subtly alter facial features (nose shape, jawline, eye spacing) even when instructed not to. This is the primary quality risk in v2.

**Mitigations:**
- Prompt engineering with explicit "do not alter" instructions
- Phase 0 testing across diverse face types (different skin tones, ages, angles)
- Optional: structural similarity (SSIM) check between input and output to flag drift
- Fallback to SeedEdit 3.0 if Gemini shows systematic drift on certain face types

---

## 8. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Web framework** | Python FastAPI | Handles upload, processing, and serves HTML |
| **Frontend** | HTML + Jinja2 templates + vanilla JS | No build step, no separate service, keeps it simple |
| **Face detection** | MediaPipe Face Detection | More accurate than Haar cascades (autocrop), handles angles and partial occlusion better, Google-maintained |
| **AI retouch** | Gemini 3 Pro Image API (`google-genai` SDK) | Image-to-image in a single call, prompt-based control |
| **Image processing** | Pillow | Crop geometry, resize to delivery sizes, export |
| **Hosting** | Fly.io or Render (free tier) | Sufficient for single-user MVP |

**Changed from v1:** Removed Next.js frontend (was separate Node service). Everything is now a single Python process — FastAPI serves the HTML directly. Replaced `autocrop` (Haar cascades) with MediaPipe for better face detection accuracy.

### Dependencies

```
fastapi
uvicorn
python-multipart
jinja2
pillow
mediapipe
google-genai
```

---

## 9. Phase 0 — Validation Script

**Goal:** Prove the retouch pipeline works on real headshots in under 1 hour.

**What you need:**
- A `GEMINI_API_KEY` environment variable set
- 3–5 sample headshot photos in a test directory
- The `nano-banana-pro` skill (already installed)

**Script:**

```bash
#!/bin/bash
# phase0_validate.sh — Test Gemini retouch on sample headshots
# Run from project root: bash phase0_validate.sh

set -e

INPUT_DIR="./test-photos"
OUTPUT_DIR="./test-output"
mkdir -p "$OUTPUT_DIR"

PROMPT_MEDIUM="Apply conservative portrait retouching: smooth minor skin blemishes, even out skin tone slightly, reduce under-eye shadows. Keep all facial features, hair, and expression exactly the same. Do not alter face shape, eye color, bone structure, or hair. The person must be immediately recognizable as themselves."

echo "=== SnapReady Phase 0 Validation ==="
echo "Processing photos in $INPUT_DIR..."

for photo in "$INPUT_DIR"/*.{jpg,jpeg,png,JPG,JPEG,PNG}; do
  [ -f "$photo" ] || continue
  basename=$(basename "$photo" | sed 's/\.[^.]*$//')
  output="$OUTPUT_DIR/${basename}-retouched.png"

  echo ""
  echo "--- Processing: $photo ---"

  uv run ~/.claude/skills/nano-banana-pro/scripts/generate_image.py \
    --prompt "$PROMPT_MEDIUM" \
    --input-image "$photo" \
    --filename "$output" \
    --resolution 2K

  echo "Output: $output"
done

echo ""
echo "=== Done. Compare input/output pairs in $OUTPUT_DIR ==="
echo "Check for: skin smoothing quality, facial feature preservation, color accuracy"
```

**What to evaluate:**
1. Does skin look smoother without plastic/airbrushed artifacts?
2. Are facial features (eyes, nose, jawline) preserved exactly?
3. Is the color/white balance unchanged?
4. Is the output resolution acceptable?
5. How long does each API call take?

**Expected results:** ~3–8 seconds per photo, cost < $0.20 for 5 test photos.

---

## 10. Cost Model

| Component | Cost | Notes |
|---|---|---|
| **Gemini 3 Pro Image API** | ~$0.01–$0.04 per photo | Varies by resolution (1K/2K/4K) |
| **MediaPipe face detection** | Free (local) | Runs on CPU, no API call |
| **Pillow resize/export** | Free (local) | |
| **Hosting (Fly.io free tier)** | $0/month | 3 shared-cpu VMs, 256 MB RAM |

**Running cost at 20 photos/week:** ~$0.40–$0.80/week ($1.60–$3.20/month)

**Phase 0 validation cost:** < $0.20 (5 test photos)

**Comparison to v1:** Similar per-photo cost ($0.01–$0.03 for Claude Vision vs $0.01–$0.04 for Gemini), but fewer failure-related retries since the pipeline is simpler.

---

## 11. Build Phases

### Phase 0: Validate Retouch Quality (Day 1)

- Run `phase0_validate.sh` on 5 diverse headshots
- Evaluate output quality against the Quality Bar table
- Test all three intensity prompts (Light / Medium / Strong)
- **Go/no-go decision:** Are 3 out of 5 outputs "good enough" at Medium intensity?

### Phase 1: MVP Web App (Days 2–7)

- FastAPI app with upload endpoint and HTML UI
- MediaPipe face detection + crop logic
- Gemini retouch integration (Medium intensity default)
- Intensity slider (re-processes on change)
- Before/after comparison view
- ZIP download with 1×1 and 4×5 sizes
- Basic error handling (no face detected, API failure, file too large)

### Phase 2: Polish & Edge Cases (Days 8–10)

- Test with 20+ real client photos
- Tune retouch prompts based on failure cases
- Add SSIM drift detection (warn if output diverges too much)
- Loading states, error messages, mobile-responsive layout
- Deploy to Fly.io or Render

### Phase 3: Feedback Loop (Ongoing)

- Use it on real client work
- Track: how often output needs manual touch-up
- Iterate on prompts, consider SeedEdit fallback if needed

**Total timeline: ~2 weeks** (down from ~4 weeks in v1, because the single-API-call retouch eliminates the most complex piece: parameter parsing and Pillow manipulation code).

---

## 12. Risks & Open Questions

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Facial feature drift** | High | Explicit prompt constraints, SSIM monitoring, diverse test set |
| **Inconsistent results across skin tones** | High | Phase 0 testing with diverse subjects, prompt tuning per failure mode |
| **Gemini API latency spikes** | Medium | Timeout + retry with exponential backoff; SeedEdit 3.0 as fallback |
| **Resolution cap** | Medium | Gemini supports up to 4K; may need upscaling for print-size deliverables |
| **Gemini API availability / rate limits** | Medium | SeedEdit 3.0 fallback via inference.sh |
| **Over-retouching on "Strong" setting** | Medium | Conservative prompt wording; user can always re-process at lower intensity |
| **MediaPipe fails on extreme angles** | Low | Graceful error: "No face detected — try a different photo" |

### Open Questions

1. **Does Gemini handle all skin tones equally well?** → Phase 0 will test this
2. **What's the maximum input resolution Gemini preserves?** → Test with 4K+ source photos
3. **Should we crop before or after retouch?** → Crop first (smaller image = faster API call, less to go wrong)
4. **Is SSIM sufficient to detect facial drift?** → May need perceptual metrics (LPIPS) for subtle changes
5. **Do we need a "reject and retry" button?** → Probably yes for Phase 2 — generative models are stochastic
