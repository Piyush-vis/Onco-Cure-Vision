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
    
    dice_score = checkpoint.get('dice_score', 'unknown')
    print(f"Model loaded. Training Dice score: {dice_score}", file=sys.stderr)
    
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
def predict_tumor(image_4ch, original_shape):
    """
    Run real U-Net inference on a 4-channel 3D MRI volume.
    Also computes Grad-CAM heatmap from the bottleneck layer.
    
    Args:
        image_4ch: numpy array (4, D, H, W) — 4 MRI modalities, already normalized
        original_shape: (D, H, W) — original volume dimensions before resizing
    
    Returns:
        seg_3d: (D, H, W) segmentation mask with BraTS labels (0,1,2,4)
        confidence: float 0-100
        metadata: dict with tumor characteristics
        gradcam: (D, H, W) Grad-CAM heatmap normalized to [0,1], or None
    """
    model = load_model()
    
    _, d, h, w = image_4ch.shape
    
    # Resize to model input size if needed
    target = CROP_SIZE
    scale_factors = [target / d, target / h, target / w]
    needs_resize = (d != target or h != target or w != target)
    
    if needs_resize:
        resized_channels = []
        for ch in range(4):
            resized_channels.append(zoom(image_4ch[ch], scale_factors, order=1))
        input_vol = np.stack(resized_channels, axis=0)
    else:
        input_vol = image_4ch
    
    # Prepare tensor: (1, 4, D, H, W)
    input_tensor = torch.tensor(input_vol, dtype=torch.float32).unsqueeze(0).to(DEVICE)
    
    # --- Standard inference (no_grad) for segmentation ---
    with torch.no_grad():
        with torch.amp.autocast(device_type='cuda' if DEVICE.type == 'cuda' else 'cpu'):
            output = model(input_tensor)  # (1, 4, 128, 128, 128)
        
        probs = torch.softmax(output, dim=1)  # (1, 4, 128, 128, 128)
        pred = torch.argmax(probs, dim=1).squeeze(0)  # (128, 128, 128)
        
        # Get confidence
        tumor_mask_pred = (pred > 0)
        if tumor_mask_pred.sum() > 0:
            tumor_probs = probs[0, 1:, :, :, :]
            max_probs = tumor_probs.max(dim=0)[0]
            confidence = float(max_probs[tumor_mask_pred].mean().item()) * 100
        else:
            confidence = 0.0
    
    seg_np = pred.cpu().numpy().astype(np.uint8)
    
    # --- Grad-CAM computation ---
    gradcam_np = None
    try:
        print("Computing Grad-CAM heatmap...", file=sys.stderr)
        # Re-run with gradients enabled, hooking into enc4 (bottleneck)
        activations = {}
        gradients = {}
        
        def save_activation(name):
            def hook(module, input, output):
                activations[name] = output.detach()
            return hook
        
        def save_gradient(name):
            def hook(module, grad_input, grad_output):
                gradients[name] = grad_output[0].detach()
            return hook
        
        # Register hooks on the bottleneck encoder
        handle_fwd = model.enc4.register_forward_hook(save_activation('enc4'))
        handle_bwd = model.enc4.register_full_backward_hook(save_gradient('enc4'))
        
        input_grad = torch.tensor(input_vol, dtype=torch.float32).unsqueeze(0).to(DEVICE)
        input_grad.requires_grad_(True)
        
        model.zero_grad()
        # Run WITHOUT autocast — mixed precision breaks backward on CPU
        output_grad = model(input_grad.float())
        
        # Target: sum of all tumor class logits (classes 1,2,3) where tumor was predicted
        tumor_score = output_grad[0, 1:, :, :, :].sum()
        tumor_score.backward()
        
        handle_fwd.remove()
        handle_bwd.remove()
        
        if 'enc4' in activations and 'enc4' in gradients:
            act = activations['enc4']   # (1, 256, D/8, H/8, W/8)
            grad = gradients['enc4']    # (1, 256, D/8, H/8, W/8)
            
            # Global average pooling of gradients
            weights = grad.mean(dim=[2, 3, 4], keepdim=True)  # (1, 256, 1, 1, 1)
            
            # Weighted combination
            cam = (weights * act).sum(dim=1, keepdim=True)  # (1, 1, D/8, H/8, W/8)
            cam = torch.relu(cam)
            
            # Upsample to input size
            cam = torch.nn.functional.interpolate(
                cam, size=(target, target, target), mode='trilinear', align_corners=False
            )
            cam = cam.squeeze().cpu().numpy()
            
            # Normalize to [0, 1]
            cam_min, cam_max = cam.min(), cam.max()
            if cam_max - cam_min > 1e-8:
                cam = (cam - cam_min) / (cam_max - cam_min)
            else:
                cam = np.zeros_like(cam)
            
            gradcam_np = cam
            
            # Resize back to original shape
            if needs_resize:
                inv_scale = [d / target, h / target, w / target]
                gradcam_np = zoom(gradcam_np, inv_scale, order=1)
            
            print("Grad-CAM computed successfully.", file=sys.stderr)
        else:
            print("Grad-CAM: hooks didn't capture data.", file=sys.stderr)
    except Exception as e:
        print(f"Grad-CAM failed (non-fatal): {e}", file=sys.stderr)
        gradcam_np = None
    
    # Resize segmentation back to original volume size
    if needs_resize:
        inv_scale = [d / target, h / target, w / target]
        seg_np = zoom(seg_np.astype(np.float32), inv_scale, order=0).astype(np.uint8)
    
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
    
    # Compute metadata from segmentation
    metadata = analyze_segmentation(brats_seg, confidence)
    
    return brats_seg, confidence, metadata, gradcam_np


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
        
        # 2. Run U-Net prediction
        print("Running U-Net inference...", file=sys.stderr)
        seg_3d, confidence, metadata, gradcam = predict_tumor(image_4ch, original_shape)
        
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
        
        # 5. Output JSON metadata to stdout for Node.js backend
        result = {
            "success": True,
            "flair_path": flair_path,
            "seg_path": seg_path,
            "has_gradcam": has_gradcam,
            "metadata": {
                "type": metadata['type'],
                "confidence": metadata['confidence'],
                "volume_cm3": tumor_volume_cm3,
                "location": metadata['location'],
                "characteristics": metadata['characteristics'],
                "nearbyRegions": [metadata['location'].split()[-1]] if metadata['location'] != "N/A" else [],
                "enhancing": metadata['characteristics']['enhancing'] == "Present",
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
