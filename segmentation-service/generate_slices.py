#!/usr/bin/env python3
"""
Generate 2D slice PNGs from NIfTI volumes for frontend visualization.
Produces 3 view types: raw FLAIR, segmentation overlay, and Grad-CAM heatmap.

Usage: python generate_slices.py <patient_folder> [--num-slices 20]
"""

import sys
import os
import json
import numpy as np
import nibabel as nib
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow", "-q"])
    from PIL import Image


# Segmentation colors (RGBA)
SEG_COLORS = {
    1: (168, 85, 247, 160),   # Necrotic - purple
    2: (59, 130, 246, 130),   # Edema - blue
    4: (239, 68, 68, 180),    # Enhancing - red
}

IMG_SIZE = (256, 256)


def normalize_to_uint8(arr):
    """Normalize array to 0-255 uint8."""
    arr = arr.astype(np.float64)
    mn, mx = arr.min(), arr.max()
    if mx - mn > 1e-8:
        arr = (arr - mn) / (mx - mn) * 255.0
    return arr.astype(np.uint8)


def jet_colormap(value):
    """Simple jet colormap: value in [0,1] -> (R,G,B)."""
    if value < 0.25:
        r, g, b = 0, int(255 * (value / 0.25)), 255
    elif value < 0.5:
        r, g, b = 0, 255, int(255 * (1 - (value - 0.25) / 0.25))
    elif value < 0.75:
        r, g, b = int(255 * ((value - 0.5) / 0.25)), 255, 0
    else:
        r, g, b = 255, int(255 * (1 - (value - 0.75) / 0.25)), 0
    return (min(255, max(0, r)), min(255, max(0, g)), min(255, max(0, b)))


def apply_jet_colormap(heatmap_uint8):
    """Apply jet colormap to a uint8 heatmap, returning RGB array."""
    lut = np.array([jet_colormap(i / 255.0) for i in range(256)], dtype=np.uint8)
    return lut[heatmap_uint8]


def make_raw_image(flair_slice):
    """Grayscale FLAIR slice."""
    gray = normalize_to_uint8(flair_slice)
    img = Image.fromarray(gray, mode='L').resize(IMG_SIZE, Image.BILINEAR)
    return img.convert('RGB')


def make_seg_overlay(flair_slice, seg_slice):
    """FLAIR with colored segmentation overlay."""
    gray = normalize_to_uint8(flair_slice)
    bg = Image.fromarray(gray, mode='L').resize(IMG_SIZE, Image.BILINEAR).convert('RGBA')

    seg_resized = np.array(
        Image.fromarray(seg_slice.astype(np.uint8), mode='L').resize(IMG_SIZE, Image.NEAREST)
    )

    overlay_arr = np.zeros((*IMG_SIZE, 4), dtype=np.uint8)
    for label, color in SEG_COLORS.items():
        mask = seg_resized == label
        if mask.any():
            overlay_arr[mask] = color

    overlay = Image.fromarray(overlay_arr, mode='RGBA')
    result = Image.alpha_composite(bg, overlay)
    return result.convert('RGB')


def make_heatmap_overlay(flair_slice, heatmap_slice):
    """FLAIR with Grad-CAM heatmap overlay."""
    gray = normalize_to_uint8(flair_slice)
    bg = Image.fromarray(gray, mode='L').resize(IMG_SIZE, Image.BILINEAR)
    bg_rgb = np.array(bg.convert('RGB'))

    heat = normalize_to_uint8(heatmap_slice)
    heat_resized = np.array(Image.fromarray(heat, mode='L').resize(IMG_SIZE, Image.BILINEAR))

    # Apply jet colormap
    heat_rgb = apply_jet_colormap(heat_resized)

    # Blend: where heatmap > threshold, blend with jet colors
    alpha = (heat_resized.astype(np.float32) / 255.0 * 0.6)[:, :, np.newaxis]
    blended = (bg_rgb * (1 - alpha) + heat_rgb * alpha).astype(np.uint8)

    return Image.fromarray(blended, mode='RGB')


def get_slice(volume, axis, index):
    """Extract and orient a 2D slice."""
    if axis == 0:
        s = volume[index, :, :]
    elif axis == 1:
        s = volume[:, index, :]
    else:
        s = volume[:, :, index]
    return np.rot90(s)


def find_tumor_center(seg_vol):
    """Find the slice index with the most tumor voxels per axis."""
    tumor_mask = seg_vol > 0
    centers = {}
    for axis in range(3):
        counts = tumor_mask.sum(axis=tuple(i for i in range(3) if i != axis))
        centers[axis] = int(np.argmax(counts)) if counts.max() > 0 else seg_vol.shape[axis] // 2
    return centers


def generate_all_slices(patient_folder, num_slices=20):
    """Generate raw, segmentation, and heatmap slices."""
    path = Path(patient_folder)
    flair_path = path / 'brain_flair.nii'
    seg_path = path / 'tumor_seg.nii'
    heatmap_path = path / 'gradcam_heatmap.nii'

    if not flair_path.exists():
        print(json.dumps({"error": f"brain_flair.nii not found in {path}"}))
        sys.exit(1)
    if not seg_path.exists():
        print(json.dumps({"error": f"tumor_seg.nii not found in {path}"}))
        sys.exit(1)

    print(f"Loading volumes...", file=sys.stderr)
    flair = nib.load(str(flair_path)).get_fdata()
    seg = nib.load(str(seg_path)).get_fdata()

    has_heatmap = heatmap_path.exists()
    heatmap = nib.load(str(heatmap_path)).get_fdata() if has_heatmap else None
    if has_heatmap:
        print(f"Grad-CAM heatmap found.", file=sys.stderr)

    slices_dir = path / 'slices'
    slices_dir.mkdir(exist_ok=True)

    # Find tumor center to generate slices around the interesting region
    tumor_centers = find_tumor_center(seg)

    planes = [('axial', 2), ('sagittal', 0), ('coronal', 1)]
    manifest = {'planes': {}, 'hasHeatmap': has_heatmap}

    for plane_name, axis in planes:
        total = flair.shape[axis]
        center = tumor_centers[axis]

        # Generate slices centered around tumor, covering 60% of volume
        span = int(total * 0.3)
        start = max(0, center - span)
        end = min(total - 1, center + span)
        indices = np.linspace(start, end, num_slices, dtype=int)

        raw_files = []
        seg_files = []
        heatmap_files = []

        for i, idx in enumerate(indices):
            f_slice = get_slice(flair, axis, idx)
            s_slice = get_slice(seg, axis, idx)

            # Raw FLAIR
            fname_raw = f"raw_{plane_name}_{i:03d}.png"
            make_raw_image(f_slice).save(str(slices_dir / fname_raw), optimize=True)
            raw_files.append(fname_raw)

            # Segmentation overlay
            fname_seg = f"seg_{plane_name}_{i:03d}.png"
            make_seg_overlay(f_slice, s_slice).save(str(slices_dir / fname_seg), optimize=True)
            seg_files.append(fname_seg)

            # Heatmap overlay
            if has_heatmap:
                h_slice = get_slice(heatmap, axis, idx)
                fname_heat = f"heat_{plane_name}_{i:03d}.png"
                make_heatmap_overlay(f_slice, h_slice).save(str(slices_dir / fname_heat), optimize=True)
                heatmap_files.append(fname_heat)

        manifest['planes'][plane_name] = {
            'count': len(raw_files),
            'raw': raw_files,
            'seg': seg_files,
            'heatmap': heatmap_files,
        }
        print(f"  {plane_name}: {len(raw_files)} slices generated", file=sys.stderr)

    with open(str(slices_dir / 'manifest.json'), 'w') as f:
        json.dump(manifest, f)

    total_slices = sum(p['count'] for p in manifest['planes'].values())
    total_images = total_slices * (3 if has_heatmap else 2)
    print(f"Done! {total_images} images saved.", file=sys.stderr)

    print(json.dumps({'success': True, 'totalSlices': total_slices, 'hasHeatmap': has_heatmap}))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python generate_slices.py <patient_folder>", file=sys.stderr)
        sys.exit(1)

    num = 20
    if '--num-slices' in sys.argv:
        num = int(sys.argv[sys.argv.index('--num-slices') + 1])

    generate_all_slices(sys.argv[1], num)
