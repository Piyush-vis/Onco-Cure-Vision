"""
Real U-Net inference for brain tumor segmentation.

Replaces the mock predict_tumor() with actual model inference.
Supports both DICOM and NIfTI input files.

Usage:
    python predict_segmentation.py <input_folder>

Output (stdout JSON):
    - segmentation metadata (type, confidence, volume, characteristics)
    - saves brain_flair.nii and tumor_seg.nii to input_folder for mesh_generator.py
"""

import os
import sys
import json
import hashlib
import numpy as np
import pydicom
import nibabel as nib
import torch
from scipy.ndimage import zoom, label as nd_label
from unet3d import UNet3D


# ─── Constants ──────────────────────────────────────────────
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
MODEL_PATH = os.path.join(MODEL_DIR, 'best_model.pth')
CROP_SIZE = 128   # Must match training crop size
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Provenance: identifies exactly which model produced a result (for the audit trail).
MODEL_VERSION = 'unet3d-brats2020-v1'


def _file_sha1(fpath, _cache={}):
    """SHA-1 of a file's bytes, cached (used to fingerprint the model weights)."""
    if fpath in _cache:
        return _cache[fpath]
    h = hashlib.sha1()
    try:
        with open(fpath, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        digest = h.hexdigest()[:16]
    except OSError:
        digest = 'unknown'
    _cache[fpath] = digest
    return digest


def _array_sha1(arr):
    """Short SHA-1 of an array's bytes — a reproducible fingerprint of the input."""
    return hashlib.sha1(np.ascontiguousarray(arr).tobytes()).hexdigest()[:16]

# Test-time augmentation: identity + one flip per spatial axis. Each pass yields
# an independent prediction; their spread is our epistemic uncertainty estimate,
# and averaging them stabilizes both the segmentation and the Grad-CAM heatmap.
# Spatial dims in the (1, 4, D, H, W) tensor are 2, 3, 4.
TTA_FLIPS = [(), (2,), (3,), (4,)]
# Allow overriding the number of TTA passes (e.g. TTA_PASSES=1 for a fast CPU run).
TTA_PASSES = max(1, min(len(TTA_FLIPS), int(os.environ.get('TTA_PASSES', len(TTA_FLIPS)))))

# "Flag for review" thresholds: low confidence OR high in-tumor uncertainty.
REVIEW_CONF_THRESHOLD = 65.0     # percent
REVIEW_UNC_THRESHOLD = 0.35      # normalized predictive entropy in tumor region [0,1]

# Global model cache
_MODEL = None


# ─── Model Loading ──────────────────────────────────────────
def load_model():
    """Load the trained U-Net model. Cached after first call."""
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"Model weights not found at {MODEL_PATH}. "
            "Please train the model first with: python train_unet.py"
        )
    
    print(f"Loading model from {MODEL_PATH}...", file=sys.stderr)
    
    model = UNet3D(in_channels=4, out_channels=4, base_filters=32)
    checkpoint = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=False)
    model.load_state_dict(checkpoint['model_state_dict'])
    model.to(DEVICE)
    model.eval()

    # Temperature scaling for calibrated confidence. A temperature fitted on the
    # validation set (via negative-log-likelihood minimization) can be stored in
    # the checkpoint; absent that, T=1.0 leaves probabilities unchanged.
    model._temperature = float(checkpoint.get('temperature', 1.0)) or 1.0

    dice_score = checkpoint.get('dice_score', 'unknown')
    print(f"Model loaded. Training Dice score: {dice_score} | "
          f"temperature: {model._temperature}", file=sys.stderr)

    _MODEL = model
    return _MODEL


# ─── Normalization ──────────────────────────────────────────
def normalize(volume):
    """Z-score normalization on non-zero voxels (same as training)."""
    mask = volume > 0
    if mask.sum() == 0:
        return volume.astype(np.float32)
    mean = volume[mask].mean()
    std = volume[mask].std()
    volume = volume.astype(np.float32)
    volume[mask] = (volume[mask] - mean) / (std + 1e-8)
    return volume


# ─── DICOM de-identification ────────────────────────────────
# PHI tags scrubbed on ingest so stored studies can't leak identity.
_PHI_TAGS = [
    'PatientName', 'PatientID', 'PatientBirthDate', 'PatientAddress',
    'PatientTelephoneNumbers', 'PatientMotherBirthName', 'OtherPatientIDs',
    'OtherPatientNames', 'ReferringPhysicianName', 'PerformingPhysicianName',
    'PhysiciansOfRecord', 'OperatorsName', 'InstitutionName', 'InstitutionAddress',
    'StationName', 'InstitutionalDepartmentName', 'AccessionNumber',
    'StudyID', 'DeviceSerialNumber',
]


def deidentify_dicom_folder(folder_path):
    """
    Strip common PHI tags from every DICOM in a folder, in place.

    Keeps pixel data and geometry (needed for inference) but replaces identifying
    tags with anonymized placeholders. Best-effort — a full clinical de-id would
    also handle private tags and burned-in pixel annotations.
    """
    scrubbed = 0
    for f in os.listdir(folder_path):
        if not (f.lower().endswith('.dcm') or f.lower().endswith('.dicom')):
            continue
        fpath = os.path.join(folder_path, f)
        try:
            ds = pydicom.dcmread(fpath)
        except Exception:
            continue
        for tag in _PHI_TAGS:
            if tag in ds:
                try:
                    ds.data_element(tag).value = 'ANONYMIZED' if tag not in (
                        'PatientBirthDate',) else ''
                except Exception:
                    pass
        # Mark as de-identified per DICOM standard.
        try:
            ds.PatientIdentityRemoved = 'YES'
            ds.DeidentificationMethod = 'OncoCureVision basic tag scrub'
        except Exception:
            pass
        try:
            ds.save_as(fpath)
            scrubbed += 1
        except Exception as e:
            print(f"De-id: could not re-save {f}: {e}", file=sys.stderr)
    if scrubbed:
        print(f"De-identified {scrubbed} DICOM file(s).", file=sys.stderr)
    return scrubbed


# ─── File Loading ───────────────────────────────────────────
def load_dicom_series(folder_path):
    """Load all DICOM files from a folder and return a 3D numpy array."""
    slices = []
    for f in os.listdir(folder_path):
        if f.lower().endswith('.dcm') or f.lower().endswith('.dicom'):
            try:
                ds = pydicom.dcmread(os.path.join(folder_path, f))
                slices.append(ds)
            except Exception:
                pass
    
    if not slices:
        return None, None
    
    # Sort by Z position or InstanceNumber
    slices.sort(key=lambda x: float(x.ImagePositionPatient[2]) 
                if hasattr(x, 'ImagePositionPatient') else int(x.InstanceNumber))
    
    image_3d = np.stack([s.pixel_array.astype(np.float32) for s in slices])
    return image_3d, slices[0]


def load_nifti_files(folder_path):
    """
    Load NIfTI files from folder. Handles two cases:
    1. BraTS-style: separate t1, t1ce, t2, flair, [seg] files
    2. Single NIfTI: one brain volume file
    
    Returns: (image_4ch, seg_if_exists, affine, original_shape)
    """
    nii_files = {}
    for f in os.listdir(folder_path):
        fl = f.lower()
        if fl.endswith('.nii') or fl.endswith('.nii.gz'):
            full_path = os.path.join(folder_path, f)
            # Categorize by modality
            if 't1ce' in fl or 't1gd' in fl:
                nii_files['t1ce'] = full_path
            elif 't1' in fl and 'ce' not in fl:
                nii_files['t1'] = full_path
            elif 't2' in fl:
                nii_files['t2'] = full_path
            elif 'flair' in fl:
                nii_files['flair'] = full_path
            elif 'seg' in fl or 'mask' in fl or 'label' in fl:
                nii_files['seg'] = full_path
            else:
                # Generic / single file
                if 'generic' not in nii_files:
                    nii_files['generic'] = full_path
    
    seg_data = None
    
    # Case 1: BraTS-style with all 4 modalities
    if all(k in nii_files for k in ['t1', 't1ce', 't2', 'flair']):
        print("  Found BraTS-style 4-modality NIfTI files", file=sys.stderr)
        t1 = nib.load(nii_files['t1'])
        affine = t1.affine
        
        t1_data = normalize(t1.get_fdata())
        t1ce_data = normalize(nib.load(nii_files['t1ce']).get_fdata())
        t2_data = normalize(nib.load(nii_files['t2']).get_fdata())
        flair_data = normalize(nib.load(nii_files['flair']).get_fdata())
        
        image_4ch = np.stack([t1_data, t1ce_data, t2_data, flair_data], axis=0)
        
        if 'seg' in nii_files:
            seg_data = nib.load(nii_files['seg']).get_fdata()
        
        return image_4ch, seg_data, affine, t1_data.shape
    
    # Case 2: Single NIfTI file — duplicate across 4 channels
    single_path = nii_files.get('flair') or nii_files.get('t2') or nii_files.get('generic')
    if single_path is None:
        single_path = next(iter(nii_files.values()))
    
    print(f"  Single NIfTI file mode: {os.path.basename(single_path)}", file=sys.stderr)
    nii = nib.load(single_path)
    data = normalize(nii.get_fdata())
    
    # Duplicate to 4 channels (model expects 4 input channels)
    image_4ch = np.stack([data, data, data, data], axis=0)
    
    if 'seg' in nii_files:
        seg_data = nib.load(nii_files['seg']).get_fdata()
    
    return image_4ch, seg_data, nii.affine, data.shape


# ─── Inference ──────────────────────────────────────────────
def _cam_from_hooks(activations, gradients, target):
    """Build a Grad-CAM volume (numpy, at `target` resolution) from enc3 hooks."""
    act = activations['enc3']   # (1, 128, D/4, H/4, W/4)
    grad = gradients['enc3']    # (1, 128, D/4, H/4, W/4)
    weights = grad.mean(dim=[2, 3, 4], keepdim=True)   # channel importance
    cam = torch.relu((weights * act).sum(dim=1, keepdim=True))  # (1,1,D/4,H/4,W/4)
    cam = torch.nn.functional.interpolate(
        cam, size=(target, target, target), mode='trilinear', align_corners=False
    )
    return cam  # (1, 1, target, target, target) — still a tensor, in flipped space


def predict_tumor(image_4ch, original_shape):
    """
    Run test-time-augmented U-Net inference on a 4-channel 3D MRI volume.

    Runs the model over several flip augmentations. Averaging the softmax outputs
    stabilizes the segmentation and yields a per-voxel predictive-entropy map
    (epistemic uncertainty); the spread across passes gives a confidence interval.
    An ensemble Grad-CAM (averaged over the same passes) is masked to the brain and
    targeted at the predicted tumor region, and scored for agreement with the mask.

    Args:
        image_4ch: numpy array (4, D, H, W) — 4 MRI modalities, already normalized
        original_shape: (D, H, W) — original volume dimensions before resizing

    Returns:
        seg_3d:      (D, H, W) segmentation mask with BraTS labels (0,1,2,4)
        confidence:  float 0-100 (calibrated, mean over TTA passes)
        metadata:    dict with tumor characteristics + uncertainty fields
        gradcam:     (D, H, W) ensemble Grad-CAM heatmap in [0,1], or None
        uncertainty: (D, H, W) normalized predictive-entropy map in [0,1], or None
    """
    model = load_model()
    temperature = getattr(model, '_temperature', 1.0)

    _, d, h, w = image_4ch.shape

    # Resize to model input size if needed
    target = CROP_SIZE
    scale_factors = [target / d, target / h, target / w]
    needs_resize = (d != target or h != target or w != target)

    if needs_resize:
        resized_channels = [zoom(image_4ch[ch], scale_factors, order=1) for ch in range(4)]
        input_vol = np.stack(resized_channels, axis=0)
    else:
        input_vol = image_4ch

    base_tensor = torch.tensor(input_vol, dtype=torch.float32).unsqueeze(0).to(DEVICE)

    # Brain mask at model resolution: background was z-scored to exactly 0 across
    # every channel, so any in-channel signal marks brain tissue.
    brain_mask = np.abs(input_vol).sum(axis=0) > 1e-5  # (target, target, target) bool

    flips = TTA_FLIPS[:TTA_PASSES]

    # --- Grad-CAM hooks on enc3 (D/4 = 32^3): fine enough to localize, deep
    # enough to carry tumor semantics. Registered once, reused each pass. ---
    activations, gradients = {}, {}

    def save_activation(name):
        def hook(module, inp, output):
            activations[name] = output.detach()
        return hook

    def save_gradient(name):
        def hook(module, grad_input, grad_output):
            gradients[name] = grad_output[0].detach()
        return hook

    handle_fwd = model.enc3.register_forward_hook(save_activation('enc3'))
    handle_bwd = model.enc3.register_full_backward_hook(save_gradient('enc3'))

    prob_sum = None                 # accumulates mean softmax (canonical orientation)
    per_pass_conf = []              # per-pass whole-tumor confidence, for the CI
    cam_sum = np.zeros((target, target, target), dtype=np.float32)
    cam_passes = 0

    print(f"Running {len(flips)}-pass TTA inference...", file=sys.stderr)
    for flip in flips:
        inp = base_tensor if not flip else torch.flip(base_tensor, dims=flip)
        inp = inp.clone().requires_grad_(True)

        model.zero_grad()
        # No autocast: mixed precision breaks backward on CPU.
        out = model(inp)  # (1, 4, target, target, target), grad enabled

        # Un-flip logits back to canonical orientation before softmax.
        out_canon = out if not flip else torch.flip(out, dims=flip)
        probs = torch.softmax(out_canon / temperature, dim=1).detach()
        prob_sum = probs.clone() if prob_sum is None else prob_sum + probs

        # Per-pass confidence: mean top-tumor-class prob where this pass sees tumor.
        pass_pred = torch.argmax(probs, dim=1)[0]
        pass_tumor = pass_pred > 0
        if pass_tumor.any():
            pm = probs[0, 1:].max(dim=0)[0]
            per_pass_conf.append(float(pm[pass_tumor].mean().item()) * 100)
        else:
            per_pass_conf.append(0.0)

        # --- Ensemble Grad-CAM: compute in this pass's (flipped) space, then
        # un-flip so every pass's CAM lands in the same canonical frame. ---
        try:
            with torch.no_grad():
                pred_region_f = (torch.argmax(out, dim=1)[0] > 0)  # flipped space
            tumor_logits_f = out[0, 1:, :, :, :].sum(dim=0)
            if pred_region_f.any():
                score = (tumor_logits_f * pred_region_f.float()).sum()
            else:
                score = tumor_logits_f.max()
            score.backward()

            if 'enc3' in activations and 'enc3' in gradients:
                cam = _cam_from_hooks(activations, gradients, target)  # (1,1,...) flipped
                if flip:
                    cam = torch.flip(cam, dims=flip)  # back to canonical
                cam_sum += cam.squeeze().detach().cpu().numpy()
                cam_passes += 1
        except Exception as e:
            print(f"Grad-CAM pass failed (non-fatal): {e}", file=sys.stderr)
        finally:
            activations.clear()
            gradients.clear()

    handle_fwd.remove()
    handle_bwd.remove()

    n = len(flips)
    prob_mean = prob_sum / n  # (1, 4, target, target, target)
    pred = torch.argmax(prob_mean, dim=1).squeeze(0)  # (target, target, target)
    seg_np = pred.cpu().numpy().astype(np.uint8)

    # --- Whole-tumor confidence (mean over passes) + confidence interval ---
    tumor_mask_pred = (pred > 0)
    if tumor_mask_pred.sum() > 0:
        max_probs = prob_mean[0, 1:].max(dim=0)[0]
        confidence = float(max_probs[tumor_mask_pred].mean().item()) * 100
    else:
        confidence = 0.0
    conf_arr = np.array(per_pass_conf, dtype=np.float32)
    conf_std = float(conf_arr.std())
    # 95% interval from the TTA spread (falls back to the point estimate if 1 pass).
    ci_low = float(np.clip(confidence - 1.96 * conf_std, 0.0, 100.0))
    ci_high = float(np.clip(confidence + 1.96 * conf_std, 0.0, 100.0))

    # --- Per-voxel predictive entropy (epistemic uncertainty), normalized to [0,1] ---
    pm_np = prob_mean.squeeze(0).cpu().numpy()  # (4, target, target, target)
    eps = 1e-8
    entropy = -(pm_np * np.log(pm_np + eps)).sum(axis=0)  # (target, target, target)
    entropy = entropy / np.log(pm_np.shape[0])            # max entropy = log(#classes)
    entropy = (entropy * brain_mask).astype(np.float32)
    tumor_np = seg_np > 0
    tumor_uncertainty = float(entropy[tumor_np].mean()) if tumor_np.any() else 0.0

    # --- Ensemble Grad-CAM: brain-mask, robust-normalize, score agreement ---
    gradcam_np = None
    heatmap_agreement = None
    if cam_passes > 0:
        cam_mean = (cam_sum / cam_passes) * brain_mask
        brain_vals = cam_mean[brain_mask]
        if brain_vals.size > 0 and brain_vals.max() > 1e-8:
            hi = np.percentile(brain_vals, 99)
            if hi <= 1e-8:
                hi = float(brain_vals.max())
            cam_mean = np.clip(cam_mean / hi, 0.0, 1.0).astype(np.float32)
        else:
            cam_mean = np.zeros_like(cam_mean, dtype=np.float32)
        gradcam_np = cam_mean

        # Agreement = IoU between the hot heatmap region (>=0.5) and the tumor mask.
        # A low value warns the clinician the explanation and the mask disagree.
        heat_hot = gradcam_np >= 0.5
        if tumor_np.any() and heat_hot.any():
            inter = np.logical_and(heat_hot, tumor_np).sum()
            union = np.logical_or(heat_hot, tumor_np).sum()
            heatmap_agreement = float(inter) / float(union)
        else:
            heatmap_agreement = 0.0
        print(f"Grad-CAM ensemble ({cam_passes} passes) done. "
              f"Agreement IoU={heatmap_agreement:.3f}", file=sys.stderr)

    # --- Resize everything back to the original volume size ---
    if needs_resize:
        inv_scale = [d / target, h / target, w / target]
        seg_np = zoom(seg_np.astype(np.float32), inv_scale, order=0).astype(np.uint8)
        entropy = zoom(entropy, inv_scale, order=1).astype(np.float32)
        if gradcam_np is not None:
            gradcam_np = zoom(gradcam_np, inv_scale, order=1).astype(np.float32)

    # Remove small connected components (noise) — keep only components > 50 voxels
    for label_val in [1, 2, 3]:
        binary = (seg_np == label_val)
        if binary.sum() == 0:
            continue
        labeled, num_features = nd_label(binary)
        for comp_id in range(1, num_features + 1):
            comp_mask = (labeled == comp_id)
            if comp_mask.sum() < 50:
                seg_np[comp_mask] = 0

    # Convert back to BraTS labels: 0,1,2,3 -> 0,1,2,4
    brats_seg = np.zeros_like(seg_np)
    brats_seg[seg_np == 1] = 1  # necrotic
    brats_seg[seg_np == 2] = 2  # edema
    brats_seg[seg_np == 3] = 4  # enhancing

    # Compute metadata from segmentation, then attach uncertainty/XAI fields.
    metadata = analyze_segmentation(brats_seg, confidence)

    review_reasons = []
    if confidence < REVIEW_CONF_THRESHOLD:
        review_reasons.append(f"Confidence {confidence:.0f}% below {REVIEW_CONF_THRESHOLD:.0f}% threshold")
    if tumor_uncertainty > REVIEW_UNC_THRESHOLD:
        review_reasons.append(f"High model uncertainty ({tumor_uncertainty:.2f}) in tumor region")
    if heatmap_agreement is not None and heatmap_agreement < 0.2 and (brats_seg > 0).any():
        review_reasons.append("Explainability heatmap disagrees with segmentation")

    metadata['confidence_interval'] = [round(ci_low, 1), round(ci_high, 1)]
    metadata['confidence_std'] = round(conf_std, 2)
    metadata['tumor_uncertainty'] = round(tumor_uncertainty, 3)
    metadata['heatmap_agreement'] = round(heatmap_agreement, 3) if heatmap_agreement is not None else None
    metadata['tta_passes'] = n
    metadata['flag_for_review'] = bool(review_reasons)
    metadata['review_reasons'] = review_reasons

    return brats_seg, confidence, metadata, gradcam_np, entropy


def analyze_segmentation(seg, confidence):
    """Derive real metadata from the segmentation mask."""
    total_tumor = np.sum(seg > 0)
    necrotic_count = np.sum(seg == 1)
    edema_count = np.sum(seg == 2)
    enhancing_count = np.sum(seg == 4)
    
    # Tumor type classification based on sub-region ratios
    if total_tumor == 0:
        tumor_type = "No Tumor Detected"
    elif enhancing_count > total_tumor * 0.3:
        tumor_type = "High-Grade Glioma (HGG)"
    elif edema_count > total_tumor * 0.5:
        tumor_type = "Low-Grade Glioma (LGG)"
    elif necrotic_count > total_tumor * 0.4:
        tumor_type = "Glioblastoma (GBM)"
    else:
        tumor_type = "Glioma"
    
    # Margin analysis
    if total_tumor == 0:
        margins = "N/A"
    else:
        # Check regularity by comparing surface area to volume ratio
        from skimage.measure import marching_cubes
        try:
            binary_tumor = (seg > 0).astype(np.float32)
            verts, faces, _, _ = marching_cubes(binary_tumor, level=0.5)
            surface_area = 0
            for face in faces[:min(len(faces), 10000)]:
                v0, v1, v2 = verts[face[0]], verts[face[1]], verts[face[2]]
                surface_area += 0.5 * np.linalg.norm(np.cross(v1-v0, v2-v0))
            # Sphericity = ratio of surface area of sphere with same volume to actual surface area
            sphere_sa = (36 * np.pi * total_tumor**2) ** (1/3)
            sphericity = sphere_sa / (surface_area + 1e-8)
            if sphericity > 0.7:
                margins = "Well-defined"
            elif sphericity > 0.4:
                margins = "Irregular"
            else:
                margins = "Diffuse"
        except Exception:
            margins = "Irregular"
    
    return {
        'type': tumor_type,
        'confidence': round(confidence, 1),
        'necrotic_voxels': int(necrotic_count),
        'edema_voxels': int(edema_count),
        'enhancing_voxels': int(enhancing_count),
        'total_tumor_voxels': int(total_tumor),
        'characteristics': {
            'enhancing': bool(enhancing_count > 0),
            'necrotic': bool(necrotic_count > 0),
            'edema': bool(edema_count > 0),
            'margins': margins,
        },
        'location': determine_location(seg),
    }


def determine_location(seg):
    """Estimate tumor location based on center of mass."""
    tumor_mask = seg > 0
    if not np.any(tumor_mask):
        return "N/A"
    
    # Center of mass
    coords = np.argwhere(tumor_mask)
    center = coords.mean(axis=0)
    d, h, w = seg.shape
    
    # Normalize to 0-1
    cz, cy, cx = center[0] / d, center[1] / h, center[2] / w
    
    # Simple anatomical mapping (approximate)
    regions = []
    if cy < 0.4:
        regions.append("Superior")
    elif cy > 0.6:
        regions.append("Inferior")
    
    if cx < 0.45:
        regions.append("Right Hemisphere")
    elif cx > 0.55:
        regions.append("Left Hemisphere")
    else:
        regions.append("Midline")
    
    if cz < 0.35:
        regions.append("Frontal")
    elif cz > 0.65:
        regions.append("Occipital")
    elif 0.35 <= cz <= 0.55:
        regions.append("Parietal")
    else:
        regions.append("Temporal")
    
    return " ".join(regions)


# ─── Main ───────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing input folder"}))
        sys.exit(1)
    
    input_folder = sys.argv[1]
    
    if not os.path.isdir(input_folder):
        print(json.dumps({"error": f"Folder not found: {input_folder}"}))
        sys.exit(1)
    
    try:
        # 1. Detect and load input files
        print("Loading input files...", file=sys.stderr)
        
        # Check for NIfTI files first
        has_nifti = any(f.lower().endswith(('.nii', '.nii.gz')) 
                       for f in os.listdir(input_folder))
        has_dicom = any(f.lower().endswith(('.dcm', '.dicom')) 
                       for f in os.listdir(input_folder))
        
        affine = np.eye(4)
        image_4ch = None
        existing_seg = None
        original_shape = None
        
        if has_nifti:
            image_4ch, existing_seg, affine, original_shape = load_nifti_files(input_folder)
        elif has_dicom:
            # De-identify stored DICOMs before use (strip PHI in place).
            deidentify_dicom_folder(input_folder)
            image_3d, reference_dicom = load_dicom_series(input_folder)
            if image_3d is None:
                print(json.dumps({"error": "No valid DICOM files found"}))
                sys.exit(1)
            
            original_shape = image_3d.shape
            
            # Build affine from DICOM headers
            if hasattr(reference_dicom, 'PixelSpacing'):
                affine[0, 0] = float(reference_dicom.PixelSpacing[0])
                affine[1, 1] = float(reference_dicom.PixelSpacing[1])
            if hasattr(reference_dicom, 'SliceThickness'):
                affine[2, 2] = float(reference_dicom.SliceThickness)
            
            # Normalize and duplicate to 4 channels
            image_3d_norm = normalize(image_3d)
            image_4ch = np.stack([image_3d_norm, image_3d_norm, image_3d_norm, image_3d_norm], axis=0)
        else:
            print(json.dumps({"error": "No valid medical images found (.nii, .nii.gz, .dcm)"}))
            sys.exit(1)
        
        print(f"Volume shape: {original_shape}, Channels: {image_4ch.shape[0]}", file=sys.stderr)
        
        # 2. Run U-Net prediction (TTA ensemble: seg + uncertainty + Grad-CAM)
        print("Running U-Net inference...", file=sys.stderr)
        seg_3d, confidence, metadata, gradcam, uncertainty = predict_tumor(image_4ch, original_shape)
        
        # 3. Calculate real volume from voxel dimensions
        voxel_vol_mm3 = abs(affine[0, 0] * affine[1, 1] * affine[2, 2])
        if voxel_vol_mm3 == 0:
            voxel_vol_mm3 = 1.0  # fallback if affine is identity
        
        tumor_volume_cm3 = round(metadata['total_tumor_voxels'] * voxel_vol_mm3 / 1000.0, 2)
        
        # 4. Save outputs for mesh_generator.py
        # Save brain volume (use the flair channel or first channel)
        flair_data = image_4ch[3] if image_4ch.shape[0] == 4 else image_4ch[0]
        # Denormalize for visualization
        flair_viz = ((flair_data - flair_data.min()) / (flair_data.max() - flair_data.min() + 1e-8) * 255).astype(np.float32)
        
        flair_img = nib.Nifti1Image(flair_viz, affine)
        seg_img = nib.Nifti1Image(seg_3d.astype(np.float32), affine)
        
        flair_path = os.path.join(input_folder, 'brain_flair.nii')
        seg_path = os.path.join(input_folder, 'tumor_seg.nii')
        
        nib.save(flair_img, flair_path)
        nib.save(seg_img, seg_path)
        
        print(f"Saved: {flair_path}", file=sys.stderr)
        print(f"Saved: {seg_path}", file=sys.stderr)
        
        # Save Grad-CAM heatmap if computed
        has_gradcam = False
        if gradcam is not None:
            gradcam_path = os.path.join(input_folder, 'gradcam_heatmap.nii')
            gradcam_img = nib.Nifti1Image(gradcam.astype(np.float32), affine)
            nib.save(gradcam_img, gradcam_path)
            print(f"Saved: {gradcam_path}", file=sys.stderr)
            has_gradcam = True

        # Save the predictive-uncertainty heatmap if computed
        has_uncertainty = False
        if uncertainty is not None:
            uncertainty_path = os.path.join(input_folder, 'uncertainty.nii')
            uncertainty_img = nib.Nifti1Image(uncertainty.astype(np.float32), affine)
            nib.save(uncertainty_img, uncertainty_path)
            print(f"Saved: {uncertainty_path}", file=sys.stderr)
            has_uncertainty = True

        # 5. Output JSON metadata to stdout for Node.js backend
        result = {
            "success": True,
            "flair_path": flair_path,
            "seg_path": seg_path,
            "has_gradcam": has_gradcam,
            "has_uncertainty": has_uncertainty,
            # Provenance for the audit trail (which model, which input)
            "provenance": {
                "model_version": MODEL_VERSION,
                "model_hash": _file_sha1(MODEL_PATH),
                "input_hash": _array_sha1(image_4ch),
                "tta_passes": metadata.get('tta_passes'),
                "device": DEVICE.type,
            },
            "metadata": {
                "type": metadata['type'],
                "confidence": metadata['confidence'],
                "volume_cm3": tumor_volume_cm3,
                "location": metadata['location'],
                "characteristics": metadata['characteristics'],
                "nearbyRegions": [metadata['location'].split()[-1]] if metadata['location'] != "N/A" else [],
                "enhancing": metadata['characteristics']['enhancing'] == "Present",
                # Uncertainty & explainability (P1)
                "confidence_interval": metadata.get('confidence_interval'),
                "confidence_std": metadata.get('confidence_std'),
                "tumor_uncertainty": metadata.get('tumor_uncertainty'),
                "heatmap_agreement": metadata.get('heatmap_agreement'),
                "tta_passes": metadata.get('tta_passes'),
                "flag_for_review": metadata.get('flag_for_review'),
                "review_reasons": metadata.get('review_reasons', []),
            }
        }
        
        print(json.dumps(result))
        sys.exit(0)
        
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
