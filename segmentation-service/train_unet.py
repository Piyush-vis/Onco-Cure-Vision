"""
Training script for 3D U-Net on BraTS2020 dataset.

Usage:
    python train_unet.py

Trains on the BraTS2020 training data located at:
    Dataset/MICCAI_BraTS2020_TrainingData/

Saves best model to:
    models/best_model.pth

Expected training time on RTX 4060 8GB:
    ~15-20 minutes per epoch, 20 epochs = ~5-7 hours total
    But we use early stopping, so likely 2-4 hours.
"""

import os
import sys
import time
import random
import numpy as np
import nibabel as nib
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torch.cuda.amp import autocast, GradScaler
from unet3d import UNet3D


# ─── Configuration ──────────────────────────────────────────
DATASET_DIR = os.path.join(os.path.dirname(__file__), 'Dataset', 'MICCAI_BraTS2020_TrainingData')
MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')
BEST_MODEL_PATH = os.path.join(MODEL_DIR, 'best_model.pth')

CROP_SIZE = 128          # 3D crop size (128^3 fits in 8GB VRAM)
BATCH_SIZE = 1           # Safe for 8GB VRAM with 128^3 crops
NUM_EPOCHS = 20
LEARNING_RATE = 1e-4
VAL_SPLIT = 0.15         # 15% of training data for validation
NUM_WORKERS = 2          # DataLoader workers
SEED = 42


# ─── BraTS Label Utilities ──────────────────────────────────
def convert_labels(seg):
    """
    BraTS uses labels 0, 1, 2, 4. We remap to contiguous 0, 1, 2, 3.
      0 -> 0 (background)
      1 -> 1 (necrotic / non-enhancing tumor core)
      2 -> 2 (peritumoral edema)
      4 -> 3 (GD-enhancing tumor)
    """
    result = np.zeros_like(seg, dtype=np.int64)
    result[seg == 1] = 1
    result[seg == 2] = 2
    result[seg == 4] = 3
    return result


def normalize(volume):
    """Z-score normalization on non-zero voxels."""
    mask = volume > 0
    if mask.sum() == 0:
        return volume.astype(np.float32)
    mean = volume[mask].mean()
    std = volume[mask].std()
    volume = volume.astype(np.float32)
    volume[mask] = (volume[mask] - mean) / (std + 1e-8)
    return volume


def random_crop(image, seg, crop_size=128):
    """
    Random 3D crop of image (C, D, H, W) and seg (D, H, W).
    Falls back to center crop if volume is smaller than crop_size.
    """
    if isinstance(image, torch.Tensor):
        _, d, h, w = image.shape
    else:
        _, d, h, w = image.shape
    
    # Pad if necessary
    pad_d = max(0, crop_size - d)
    pad_h = max(0, crop_size - h)
    pad_w = max(0, crop_size - w)
    
    if pad_d > 0 or pad_h > 0 or pad_w > 0:
        if isinstance(image, torch.Tensor):
            image = torch.nn.functional.pad(image, (0, pad_w, 0, pad_h, 0, pad_d))
            seg = torch.nn.functional.pad(seg.unsqueeze(0), (0, pad_w, 0, pad_h, 0, pad_d)).squeeze(0)
        else:
            image = np.pad(image, ((0,0), (0,pad_d), (0,pad_h), (0,pad_w)), mode='constant')
            seg = np.pad(seg, ((0,pad_d), (0,pad_h), (0,pad_w)), mode='constant')
        d, h, w = d + pad_d, h + pad_h, w + pad_w
    
    # Random start positions
    sd = random.randint(0, d - crop_size) if d > crop_size else 0
    sh = random.randint(0, h - crop_size) if h > crop_size else 0
    sw = random.randint(0, w - crop_size) if w > crop_size else 0
    
    if isinstance(image, torch.Tensor):
        image = image[:, sd:sd+crop_size, sh:sh+crop_size, sw:sw+crop_size]
        seg = seg[sd:sd+crop_size, sh:sh+crop_size, sw:sw+crop_size]
    else:
        image = image[:, sd:sd+crop_size, sh:sh+crop_size, sw:sw+crop_size]
        seg = seg[sd:sd+crop_size, sh:sh+crop_size, sw:sw+crop_size]
    
    return image, seg


# ─── Dataset ────────────────────────────────────────────────
def _find_nii(patient_path, patient, suffix):
    """Find a NIfTI file with either .nii or .nii.gz extension."""
    for ext in ['.nii', '.nii.gz']:
        path = os.path.join(patient_path, f"{patient}_{suffix}{ext}")
        if os.path.exists(path):
            return path
    return None


class BraTSDataset(Dataset):
    """BraTS2020 dataset loader. Loads 4 MRI modalities + segmentation mask."""
    
    def __init__(self, patient_list, root_dir, crop_size=128, augment=True):
        self.root_dir = root_dir
        self.crop_size = crop_size
        self.augment = augment
        
        # Filter out patients with missing files
        self.patient_list = []
        skipped = 0
        for patient in patient_list:
            patient_path = os.path.join(root_dir, patient)
            required = ['t1', 't1ce', 't2', 'flair', 'seg']
            if all(_find_nii(patient_path, patient, s) for s in required):
                self.patient_list.append(patient)
            else:
                skipped += 1
        if skipped > 0:
            print(f"  WARNING: Skipped {skipped} patients with missing files")
    
    def __len__(self):
        return len(self.patient_list)
    
    def __getitem__(self, idx):
        patient = self.patient_list[idx]
        patient_path = os.path.join(self.root_dir, patient)
        
        # Load all 4 modalities (handles .nii and .nii.gz)
        t1 = nib.load(_find_nii(patient_path, patient, 't1')).get_fdata()
        t1ce = nib.load(_find_nii(patient_path, patient, 't1ce')).get_fdata()
        t2 = nib.load(_find_nii(patient_path, patient, 't2')).get_fdata()
        flair = nib.load(_find_nii(patient_path, patient, 'flair')).get_fdata()
        seg = nib.load(_find_nii(patient_path, patient, 'seg')).get_fdata()
        
        # Normalize each modality
        t1 = normalize(t1)
        t1ce = normalize(t1ce)
        t2 = normalize(t2)
        flair = normalize(flair)
        
        # Stack into 4-channel volume: (4, D, H, W)
        image = np.stack([t1, t1ce, t2, flair], axis=0)
        
        # Convert BraTS labels (0,1,2,4) -> (0,1,2,3)
        seg = convert_labels(seg)
        
        # Random crop to crop_size^3
        image, seg = random_crop(image, seg, self.crop_size)
        
        # Simple augmentation: random flip along each axis
        if self.augment:
            for axis in [1, 2, 3]:  # D, H, W (skip channel axis 0)
                if random.random() > 0.5:
                    image = np.flip(image, axis=axis).copy()
                    seg = np.flip(seg, axis=axis - 1).copy()
        
        image = torch.tensor(image, dtype=torch.float32)
        seg = torch.tensor(seg, dtype=torch.long)
        
        return image, seg


# ─── Dice Loss ──────────────────────────────────────────────
class DiceLoss(nn.Module):
    """Soft Dice loss for multi-class segmentation."""
    
    def __init__(self, num_classes=4, smooth=1.0):
        super().__init__()
        self.num_classes = num_classes
        self.smooth = smooth
    
    def forward(self, logits, targets):
        """
        logits: (B, C, D, H, W) — raw model output
        targets: (B, D, H, W) — integer class labels
        """
        probs = torch.softmax(logits, dim=1)
        targets_onehot = torch.nn.functional.one_hot(targets, self.num_classes)
        targets_onehot = targets_onehot.permute(0, 4, 1, 2, 3).float()
        
        # Skip class 0 (background) for dice computation
        dice = 0.0
        for c in range(1, self.num_classes):
            p = probs[:, c]
            t = targets_onehot[:, c]
            intersection = (p * t).sum()
            dice += (2.0 * intersection + self.smooth) / (p.sum() + t.sum() + self.smooth)
        
        return 1.0 - dice / (self.num_classes - 1)


class CombinedLoss(nn.Module):
    """Dice + Cross-Entropy combined loss."""
    
    def __init__(self, num_classes=4):
        super().__init__()
        self.dice = DiceLoss(num_classes)
        self.ce = nn.CrossEntropyLoss()
    
    def forward(self, logits, targets):
        return self.dice(logits, targets) + self.ce(logits, targets)


# ─── Dice Score Metric ──────────────────────────────────────
def compute_dice_score(pred, target, num_classes=4):
    """Compute per-class Dice scores. Returns dict with class names."""
    pred_classes = torch.argmax(pred, dim=1)  # (B, D, H, W)
    
    class_names = ['background', 'necrotic', 'edema', 'enhancing']
    scores = {}
    
    for c in range(1, num_classes):  # Skip background
        p = (pred_classes == c).float()
        t = (target == c).float()
        intersection = (p * t).sum()
        union = p.sum() + t.sum()
        if union == 0:
            scores[class_names[c]] = 1.0  # Both empty = perfect match
        else:
            scores[class_names[c]] = (2.0 * intersection / (union + 1e-8)).item()
    
    scores['mean'] = np.mean([scores[k] for k in ['necrotic', 'edema', 'enhancing']])
    return scores


# ─── Training Loop ──────────────────────────────────────────
def train():
    # Seed everything
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    
    # Setup device
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"\n{'='*60}")
    print(f"  Onco-Cure Vision — 3D U-Net Training")
    print(f"  Device: {device}")
    if torch.cuda.is_available():
        print(f"  GPU: {torch.cuda.get_device_name(0)}")
        print(f"  VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    print(f"{'='*60}\n")
    
    # Get patient list
    patients = sorted([d for d in os.listdir(DATASET_DIR) 
                       if os.path.isdir(os.path.join(DATASET_DIR, d)) and d.startswith('BraTS')])
    
    print(f"Found {len(patients)} patients in dataset.")
    
    if len(patients) == 0:
        print(f"ERROR: No patient folders found in {DATASET_DIR}")
        sys.exit(1)
    
    # Train/val split
    random.shuffle(patients)
    val_count = max(1, int(len(patients) * VAL_SPLIT))
    val_patients = patients[:val_count]
    train_patients = patients[val_count:]
    
    print(f"Training: {len(train_patients)} patients | Validation: {len(val_patients)} patients")
    
    # Datasets
    train_ds = BraTSDataset(train_patients, DATASET_DIR, CROP_SIZE, augment=True)
    val_ds = BraTSDataset(val_patients, DATASET_DIR, CROP_SIZE, augment=False)
    
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, 
                              num_workers=NUM_WORKERS, pin_memory=True)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, 
                            num_workers=NUM_WORKERS, pin_memory=True)
    
    # Model
    model = UNet3D(in_channels=4, out_channels=4, base_filters=32).to(device)
    param_count = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Model parameters: {param_count:,}")
    
    # Loss, optimizer, scheduler
    criterion = CombinedLoss(num_classes=4)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=NUM_EPOCHS)
    scaler = GradScaler()
    
    # Create model directory
    os.makedirs(MODEL_DIR, exist_ok=True)
    
    # Training
    best_dice = 0.0
    patience = 5
    patience_counter = 0
    
    for epoch in range(1, NUM_EPOCHS + 1):
        # ── Train ──
        model.train()
        train_loss = 0.0
        epoch_start = time.time()
        
        for batch_idx, (images, masks) in enumerate(train_loader):
            images = images.to(device)
            masks = masks.to(device)
            
            optimizer.zero_grad()
            
            with autocast():
                outputs = model(images)
                loss = criterion(outputs, masks)
            
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            
            train_loss += loss.item()
            
            if (batch_idx + 1) % 50 == 0:
                print(f"  Epoch {epoch}/{NUM_EPOCHS} | Batch {batch_idx+1}/{len(train_loader)} | Loss: {loss.item():.4f}")
        
        avg_train_loss = train_loss / len(train_loader)
        
        # ── Validate ──
        model.eval()
        val_loss = 0.0
        all_dice = {'necrotic': [], 'edema': [], 'enhancing': []}
        
        with torch.no_grad():
            for images, masks in val_loader:
                images = images.to(device)
                masks = masks.to(device)
                
                with autocast():
                    outputs = model(images)
                    loss = criterion(outputs, masks)
                
                val_loss += loss.item()
                
                dice = compute_dice_score(outputs, masks)
                for k in all_dice:
                    all_dice[k].append(dice[k])
        
        avg_val_loss = val_loss / len(val_loader)
        mean_dice = {k: np.mean(v) for k, v in all_dice.items()}
        overall_dice = np.mean(list(mean_dice.values()))
        
        epoch_time = time.time() - epoch_start
        
        print(f"\n  Epoch {epoch}/{NUM_EPOCHS} [{epoch_time:.0f}s]")
        print(f"  Train Loss: {avg_train_loss:.4f} | Val Loss: {avg_val_loss:.4f}")
        print(f"  Dice — NCR: {mean_dice['necrotic']:.3f} | ED: {mean_dice['edema']:.3f} | ET: {mean_dice['enhancing']:.3f} | Mean: {overall_dice:.3f}")
        print(f"  LR: {scheduler.get_last_lr()[0]:.6f}")
        
        # Save best model
        if overall_dice > best_dice:
            best_dice = overall_dice
            patience_counter = 0
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'dice_score': overall_dice,
                'dice_per_class': mean_dice,
            }, BEST_MODEL_PATH)
            print(f"  >> New best model saved! Dice: {overall_dice:.4f}")
        else:
            patience_counter += 1
            print(f"  -- No improvement ({patience_counter}/{patience})")
        
        scheduler.step()
        
        if patience_counter >= patience:
            print(f"\n  Early stopping at epoch {epoch} (no improvement for {patience} epochs)")
            break
        
        print()
    
    print(f"\n{'='*60}")
    print(f"  Training Complete!")
    print(f"  Best Dice Score: {best_dice:.4f}")
    print(f"  Model saved to: {BEST_MODEL_PATH}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    train()
