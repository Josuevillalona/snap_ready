#!/bin/bash
# phase0_validate.sh — Test crop + retouch pipeline on sample headshots
# Run from project root: bash phase0_validate.sh

set -e

INPUT_DIR="./test-photos"
OUTPUT_DIR="./test-output"
mkdir -p "$OUTPUT_DIR"

INTENSITIES=("light" "medium" "strong")

echo "=== SnapReady Phase 0 Validation ==="
echo "Processing photos in $INPUT_DIR..."

for photo in "$INPUT_DIR"/*.{jpg,jpeg,png,JPG,JPEG,PNG}; do
  [ -f "$photo" ] || continue
  basename=$(basename "$photo" | sed 's/\.[^.]*$//')

  for intensity in "${INTENSITIES[@]}"; do
    output="$OUTPUT_DIR/${basename}-${intensity}-retouched.jpg"

    echo ""
    echo "--- Processing: $photo (intensity: $intensity) ---"

    python3.12 -c "
from PIL import Image
from crop import detect_face, crop_headshot_square
from retouch import retouch_image

img = Image.open('$photo').convert('RGB')
face = detect_face(img)
if face is None:
    print('ERROR: No face detected in $photo')
    exit(1)

cropped = crop_headshot_square(img, face)
retouched = retouch_image(cropped, '$intensity')
retouched.save('$output', 'JPEG', quality=95)
print('Output: $output (' + str(retouched.size[0]) + 'x' + str(retouched.size[1]) + ')')
"
  done
done

echo ""
echo "=== Done. Compare input/output pairs in $OUTPUT_DIR ==="
echo "Check for: skin smoothing quality, facial feature preservation, color accuracy"
