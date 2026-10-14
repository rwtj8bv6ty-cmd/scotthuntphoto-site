"""Make small preview images for gallery thumbnail grids.

For every photo in photos/<folder>/ this writes photos/<folder>/_thumbs/<same name> (400px on the long edge)
if it doesn't exist yet. Runs before each publish, so photos added in the editor get thumbnails automatically.
"""
import os
import sys
from PIL import Image, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "photos")
made = 0
for folder, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d != "_thumbs"]
    for name in files:
        if not name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            continue
        out = os.path.join(folder, "_thumbs", name)
        if os.path.exists(out):
            continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        try:
            im = ImageOps.exif_transpose(Image.open(os.path.join(folder, name))).convert("RGB")
            im.thumbnail((400, 400), Image.LANCZOS)
            im.save(out, "JPEG", quality=78, optimize=True, progressive=True)
            made += 1
        except Exception as e:  # a broken upload shouldn't stop the site from publishing
            print(f"skipped {name}: {e}", file=sys.stderr)
print(f"made {made} thumbnails")
