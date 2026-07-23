#!/usr/bin/env python3
"""
Compare two segmentation volumes and generate overlay slice PNGs.
Blue = old only (shrinkage), Red = new only (growth), Purple = overlap (stable).

Usage: python compare_scans.py <old_folder> <new_folder> <output_folder> [--num-slices 20]
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

IMG_SIZE = (256, 256)

# Colors (RGBA)
COLOR_OLD_ONLY = (59, 130, 246, 170)    # Blue — tumor shrank here
COLOR_NEW_ONLY = (239, 68, 68, 170)     # Red — tumor grew here
COLOR_OVERLAP  = (168, 85, 247, 170)    # Purple — stable region


def normalize_to_uint8(arr):
    arr = arr.astype(np.float64)
    mn, mx = arr.min(), arr.max()
    if mx - mn > 1e-8:
        arr = (arr - mn) / (mx - mn) * 255.0
    return arr.astype(np.uint8)


def get_slice(volume, axis, index):
    if axis == 0:
        s = volume[index, :, :]
    elif axis == 1:
        s = volume[:, index, :]
    else:
        s = volume[:, :, index]
    return np.rot90(s)


def find_combined_tumor_center(seg_old, seg_new):
    """Find the slice index with the most tumor voxels (from either scan) per axis."""
    combined = (seg_old > 0) | (seg_new > 0)
    centers = {}
    for axis in range(3):
        counts = combined.sum(axis=tuple(i for i in range(3) if i != axis))
        centers[axis] = int(np.argmax(counts)) if counts.max() > 0 else combined.shape[axis] // 2
    return centers


def make_overlay_image(flair_slice, old_seg_slice, new_seg_slice):
    """Generate comparison overlay: blue=old only, red=new only, purple=overlap."""
    gray = normalize_to_uint8(flair_slice)
    bg = Image.fromarray(gray, mode='L').resize(IMG_SIZE, Image.BILINEAR).convert('RGBA')

    old_resized = np.array(Image.fromarray((old_seg_slice > 0).astype(np.uint8) * 255, mode='L').resize(IMG_SIZE, Image.NEAREST)) > 0
    new_resized = np.array(Image.fromarray((new_seg_slice > 0).astype(np.uint8) * 255, mode='L').resize(IMG_SIZE, Image.NEAREST)) > 0

    overlay_arr = np.zeros((*IMG_SIZE, 4), dtype=np.uint8)

    # Old only (shrinkage) = blue
    old_only = old_resized & ~new_resized
    overlay_arr[old_only] = COLOR_OLD_ONLY

    # New only (growth) = red
    new_only = new_resized & ~old_resized
    overlay_arr[new_only] = COLOR_NEW_ONLY

    # Overlap (stable) = purple
    overlap = old_resized & new_resized
    overlay_arr[overlap] = COLOR_OVERLAP

    overlay = Image.fromarray(overlay_arr, mode='RGBA')
    result = Image.alpha_composite(bg, overlay)
    return result.convert('RGB')


def make_side_by_side(flair_old_slice, seg_old_slice, flair_new_slice, seg_new_slice):
    """Generate side-by-side: left=old seg overlay, right=new seg overlay."""
    SEG_COLORS = {1: (168, 85, 247, 160), 2: (59, 130, 246, 130), 4: (239, 68, 68, 180)}
    half_size = (IMG_SIZE[0] // 2, IMG_SIZE[1])

    def make_half(flair_s, seg_s, size):
        gray = normalize_to_uint8(flair_s)
        bg = Image.fromarray(gray, mode='L').resize(size, Image.BILINEAR).convert('RGBA')
        seg_r = np.array(Image.fromarray(seg_s.astype(np.uint8), mode='L').resize(size, Image.NEAREST))
        # seg_r shape is (height, width) — use that for overlay array
        ov = np.zeros((*seg_r.shape, 4), dtype=np.uint8)
        for label, color in SEG_COLORS.items():
            mask = seg_r == label
            if mask.any():
                ov[mask] = color
        overlay = Image.fromarray(ov, mode='RGBA')
        return Image.alpha_composite(bg, overlay).convert('RGB')

    left = make_half(flair_old_slice, seg_old_slice, half_size)
    right = make_half(flair_new_slice, seg_new_slice, half_size)

    combined = Image.new('RGB', IMG_SIZE)
    combined.paste(left, (0, 0))
    combined.paste(right, (IMG_SIZE[0] // 2, 0))

    return combined


def _pct_change(old, new):
    """Percent change from old to new, guarding divide-by-zero."""
    if old <= 0:
        return float('inf') if new > 0 else 0.0
    return (new - old) / old * 100.0


def intensity_entropy(flair_vol, mask):
    """First-order intensity entropy (a radiomic heterogeneity proxy) within a mask."""
    vals = flair_vol[mask]
    if vals.size < 10:
        return 0.0
    hist, _ = np.histogram(vals, bins=32, density=False)
    p = hist.astype(np.float64)
    p = p[p > 0]
    p = p / p.sum()
    return float(-(p * np.log2(p)).sum())  # bits, 0..5 for 32 bins


def rano_assessment(old_seg, new_seg):
    """
    Volumetric RANO 2.0 response category.

    Tracks enhancing tumor (label 4) as the primary target for contrast-enhancing
    disease, falling back to whole-tumor burden when there is no measurable
    enhancing component. Volumetric thresholds correspond to the classic 2D RANO
    bidimensional cutoffs (≥50% decrease / ≥25% increase) mapped to volume via the
    ~1.5 power law: PR ≈ ≥65% volume decrease, PD ≈ ≥40% volume increase.
    """
    old_enh = int(np.sum(old_seg == 4))
    new_enh = int(np.sum(new_seg == 4))
    old_whole = int(np.sum(old_seg > 0))
    new_whole = int(np.sum(new_seg > 0))

    # Choose measurable target: enhancing if present at baseline, else whole tumor.
    if old_enh >= 50 or new_enh >= 50:
        target, old_v, new_v = 'enhancing tumor', old_enh, new_enh
    else:
        target, old_v, new_v = 'whole tumor', old_whole, new_whole

    change = _pct_change(old_v, new_v)

    # New enhancing lesion where there was none => progression.
    new_enhancing_lesion = (old_enh < 50 and new_enh >= 200)

    if new_v == 0 and old_v > 0:
        category, label = 'CR', 'Complete Response'
    elif new_enhancing_lesion or (change != float('inf') and change >= 40):
        category, label = 'PD', 'Progressive Disease'
    elif change == float('inf'):
        category, label = 'PD', 'Progressive Disease'
    elif change <= -65:
        category, label = 'PR', 'Partial Response'
    else:
        category, label = 'SD', 'Stable Disease'

    return {
        'category': category,
        'label': label,
        'target': target,
        'targetOldVoxels': old_v,
        'targetNewVoxels': new_v,
        'targetChangePercent': round(change, 1) if change != float('inf') else None,
        'newEnhancingLesion': bool(new_enhancing_lesion),
        'note': ('Volumetric RANO 2.0 estimate. Confirm on a follow-up scan ≥4 weeks '
                 'later and correlate with steroid dose and clinical status.'),
    }


def growth_metrics(old_voxels, new_voxels, interval_days):
    """Specific growth rate and volume doubling time from two timepoints."""
    if interval_days is None or interval_days <= 0 or old_voxels <= 0 or new_voxels <= 0:
        return {
            'intervalDays': interval_days,
            'specificGrowthRatePerDay': None,
            'volumeDoublingTimeDays': None,
            'monthlyVolumeChangePercent': None,
        }
    sgr = np.log(new_voxels / old_voxels) / interval_days  # per day
    doubling = (np.log(2) / sgr) if sgr > 1e-9 else None    # only if growing
    monthly = (np.exp(sgr * 30) - 1) * 100                  # % change per 30 days
    return {
        'intervalDays': round(interval_days, 1),
        'specificGrowthRatePerDay': round(float(sgr), 5),
        'volumeDoublingTimeDays': round(float(doubling), 1) if doubling else None,
        'monthlyVolumeChangePercent': round(float(monthly), 1),
    }


def pseudoprogression_risk(old_seg, new_seg, new_flair, rano, interval_days):
    """
    Heuristic decision support: how likely an apparent progression is treatment
    effect (pseudoprogression / radiation necrosis) rather than true tumor growth.

    NOT a diagnosis. Raises suspicion when apparent progression is accompanied by
    the hallmarks of treatment effect: a short post-treatment interval, a
    disproportionate edema increase, a rising necrotic fraction, and heterogeneous
    (patchy) new enhancement.
    """
    # Only meaningful when the scan looks like progression.
    if rano['category'] != 'PD':
        return {
            'applicable': False,
            'riskLevel': 'n/a',
            'score': 0,
            'factors': [],
            'note': 'Pseudoprogression assessment applies only to apparent progression.',
        }

    factors = []
    score = 0

    # 1) Timing: classic pseudoprogression window is within ~12 weeks of chemoradiation.
    # We only have the inter-scan interval as a proxy for time since treatment.
    if interval_days is not None and 0 < interval_days <= 90:
        score += 2
        factors.append(f"Short inter-scan interval ({int(interval_days)}d) within the typical treatment-effect window")

    # 2) Disproportionate edema increase (treatment effect often inflames white matter).
    old_ede, new_ede = int(np.sum(old_seg == 2)), int(np.sum(new_seg == 2))
    if _pct_change(old_ede, new_ede) >= 30:
        score += 1
        factors.append("Marked increase in peritumoral edema")

    # 3) Rising necrotic fraction (radiation necrosis).
    old_nec, new_nec = int(np.sum(old_seg == 1)), int(np.sum(new_seg == 1))
    if _pct_change(old_nec, new_nec) >= 30:
        score += 1
        factors.append("Increasing necrotic component (possible radiation necrosis)")

    # 4) Heterogeneous new enhancement (patchy pattern favors treatment effect).
    new_only_enh = (new_seg == 4) & (old_seg != 4)
    ent = intensity_entropy(new_flair, new_only_enh)
    if ent >= 3.5:
        score += 1
        factors.append(f"Heterogeneous new enhancement pattern (entropy {ent:.1f})")

    if score >= 4:
        level = 'high'
    elif score >= 2:
        level = 'moderate'
    else:
        level = 'low'

    return {
        'applicable': True,
        'riskLevel': level,
        'score': int(score),
        'factors': factors,
        'note': ('Decision support only — not a diagnosis. Distinguishing '
                 'pseudoprogression from true progression requires the treatment '
                 'timeline, perfusion/advanced MRI, and/or follow-up imaging.'),
    }


def generate_comparison(old_folder, new_folder, output_folder, num_slices=20, interval_days=None):
    old_path = Path(old_folder)
    new_path = Path(new_folder)
    out_path = Path(output_folder)

    # Load volumes
    old_flair = nib.load(str(old_path / 'brain_flair.nii')).get_fdata()
    old_seg = nib.load(str(old_path / 'tumor_seg.nii')).get_fdata()
    new_flair = nib.load(str(new_path / 'brain_flair.nii')).get_fdata()
    new_seg = nib.load(str(new_path / 'tumor_seg.nii')).get_fdata()

    print(f"Old shape: {old_flair.shape}, New shape: {new_flair.shape}", file=sys.stderr)

    # Ensure same shape (resize new to match old if different)
    if old_flair.shape != new_flair.shape:
        from scipy.ndimage import zoom
        scale = [o / n for o, n in zip(old_flair.shape, new_flair.shape)]
        new_flair = zoom(new_flair, scale, order=1)
        new_seg = zoom(new_seg.astype(np.float32), scale, order=0).astype(new_seg.dtype)
        print(f"Resized new to match old: {new_flair.shape}", file=sys.stderr)

    out_path.mkdir(parents=True, exist_ok=True)

    centers = find_combined_tumor_center(old_seg, new_seg)
    planes = [('axial', 2), ('sagittal', 0), ('coronal', 1)]

    manifest = {'planes': {}}

    for plane_name, axis in planes:
        total = old_flair.shape[axis]
        center = centers[axis]
        span = int(total * 0.3)
        start = max(0, center - span)
        end = min(total - 1, center + span)
        indices = np.linspace(start, end, num_slices, dtype=int)

        overlay_files = []
        sidebyside_files = []

        for i, idx in enumerate(indices):
            of_slice = get_slice(old_flair, axis, idx)
            os_slice = get_slice(old_seg, axis, idx)
            nf_slice = get_slice(new_flair, axis, idx)
            ns_slice = get_slice(new_seg, axis, idx)

            # Overlay
            fname_ov = f"cmp_overlay_{plane_name}_{i:03d}.png"
            make_overlay_image(nf_slice, os_slice, ns_slice).save(str(out_path / fname_ov), optimize=True)
            overlay_files.append(fname_ov)

            # Side by side
            fname_sbs = f"cmp_sbs_{plane_name}_{i:03d}.png"
            make_side_by_side(of_slice, os_slice, nf_slice, ns_slice).save(str(out_path / fname_sbs), optimize=True)
            sidebyside_files.append(fname_sbs)

        manifest['planes'][plane_name] = {
            'count': len(overlay_files),
            'overlay': overlay_files,
            'sideBySide': sidebyside_files,
        }
        print(f"  {plane_name}: {len(overlay_files)} comparison slices", file=sys.stderr)

    with open(str(out_path / 'comparison_manifest.json'), 'w') as f:
        json.dump(manifest, f)

    # Compute delta metrics
    old_tumor_vol = np.sum(old_seg > 0)
    new_tumor_vol = np.sum(new_seg > 0)
    old_enh = np.sum(old_seg == 4)
    new_enh = np.sum(new_seg == 4)
    old_nec = np.sum(old_seg == 1)
    new_nec = np.sum(new_seg == 1)
    old_ede = np.sum(old_seg == 2)
    new_ede = np.sum(new_seg == 2)

    overlap = np.sum((old_seg > 0) & (new_seg > 0))
    growth = np.sum((new_seg > 0) & (old_seg == 0))
    shrinkage = np.sum((old_seg > 0) & (new_seg == 0))

    vol_change_pct = round(((new_tumor_vol - old_tumor_vol) / max(old_tumor_vol, 1)) * 100, 1)

    # RANO 2.0 response assessment, growth kinetics, and pseudoprogression triage.
    rano = rano_assessment(old_seg, new_seg)
    growth_kin = growth_metrics(int(old_tumor_vol), int(new_tumor_vol), interval_days)
    pseudo = pseudoprogression_risk(old_seg, new_seg, new_flair, rano, interval_days)

    metrics = {
        'volumeChange': {
            'oldVoxels': int(old_tumor_vol),
            'newVoxels': int(new_tumor_vol),
            'changePercent': float(vol_change_pct),
        },
        'subRegions': {
            'enhancingChange': int(new_enh) - int(old_enh),
            'necroticChange': int(new_nec) - int(old_nec),
            'edemaChange': int(new_ede) - int(old_ede),
        },
        'spatial': {
            'overlapVoxels': int(overlap),
            'growthVoxels': int(growth),
            'shrinkageVoxels': int(shrinkage),
        },
        # Coarse legacy label (kept for backward compatibility with the UI).
        'assessment': 'Improving' if vol_change_pct < -10 else ('Progressing' if vol_change_pct > 10 else 'Stable'),
        # Clinical-grade additions (P2)
        'rano': rano,
        'growth': growth_kin,
        'pseudoprogression': pseudo,
    }

    total_imgs = sum(p['count'] * 2 for p in manifest['planes'].values())
    print(f"Done! {total_imgs} images saved.", file=sys.stderr)

    print(json.dumps({'success': True, 'metrics': metrics}))


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python compare_scans.py <old_folder> <new_folder> <output_folder>", file=sys.stderr)
        sys.exit(1)

    num = 20
    if '--num-slices' in sys.argv:
        num = int(sys.argv[sys.argv.index('--num-slices') + 1])

    interval = None
    if '--interval-days' in sys.argv:
        try:
            interval = float(sys.argv[sys.argv.index('--interval-days') + 1])
        except (ValueError, IndexError):
            interval = None

    generate_comparison(sys.argv[1], sys.argv[2], sys.argv[3], num, interval_days=interval)
