"""Export retouched images as a ZIP with both square and portrait sizes."""

import io
import zipfile

from PIL import Image


def build_zip(retouched_image: Image.Image, job_id: str) -> bytes:
    """Resize retouched image to both delivery sizes and package as ZIP."""
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1200x1200 square
        square = retouched_image.copy()
        square = square.resize((1200, 1200), Image.LANCZOS)
        sq_buf = io.BytesIO()
        square.save(sq_buf, format="JPEG", quality=92)
        zf.writestr(f"{job_id}_square_1200x1200.jpg", sq_buf.getvalue())

        # 960x1200 portrait (4:5)
        portrait = retouched_image.copy()
        portrait = portrait.resize((960, 1200), Image.LANCZOS)
        pt_buf = io.BytesIO()
        portrait.save(pt_buf, format="JPEG", quality=92)
        zf.writestr(f"{job_id}_portrait_960x1200.jpg", pt_buf.getvalue())

    return buf.getvalue()
