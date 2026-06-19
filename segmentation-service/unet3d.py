"""
3D U-Net Architecture for Brain Tumor Segmentation (BraTS)

Input:  (B, 4, 128, 128, 128) — 4 MRI modalities (T1, T1ce, T2, FLAIR)
Output: (B, 4, 128, 128, 128) — 4 classes (background, necrotic, edema, enhancing)

BraTS label mapping:
  0 = background
  1 = necrotic / non-enhancing tumor core (NCR/NET)
  2 = peritumoral edema (ED)
  4 = GD-enhancing tumor (ET) -> remapped to 3 for contiguous labels
"""

import torch
import torch.nn as nn


class ConvBlock(nn.Module):
    """Two 3x3x3 convolutions with instance norm and LeakyReLU."""
    
    def __init__(self, in_ch, out_ch):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv3d(in_ch, out_ch, 3, padding=1, bias=False),
            nn.InstanceNorm3d(out_ch),
            nn.LeakyReLU(0.01, inplace=True),
            nn.Conv3d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.InstanceNorm3d(out_ch),
            nn.LeakyReLU(0.01, inplace=True),
        )

    def forward(self, x):
        return self.conv(x)


class UNet3D(nn.Module):
    """
    Compact 3D U-Net for BraTS segmentation.
    
    Encoder channels: 32 -> 64 -> 128 -> 256
    Fits in 8GB VRAM with 128^3 input crops and batch_size=1-2.
    """

    def __init__(self, in_channels=4, out_channels=4, base_filters=32):
        super().__init__()
        
        f = base_filters  # 32
        
        # Encoder
        self.enc1 = ConvBlock(in_channels, f)       # 32
        self.enc2 = ConvBlock(f, f * 2)              # 64
        self.enc3 = ConvBlock(f * 2, f * 4)          # 128
        self.enc4 = ConvBlock(f * 4, f * 8)          # 256 (bottleneck)

        self.pool = nn.MaxPool3d(2)
        
        # Decoder
        self.up3 = nn.ConvTranspose3d(f * 8, f * 4, 2, stride=2)
        self.dec3 = ConvBlock(f * 8, f * 4)          # 128 (concat from enc3)
        
        self.up2 = nn.ConvTranspose3d(f * 4, f * 2, 2, stride=2)
        self.dec2 = ConvBlock(f * 4, f * 2)          # 64 (concat from enc2)
        
        self.up1 = nn.ConvTranspose3d(f * 2, f, 2, stride=2)
        self.dec1 = ConvBlock(f * 2, f)              # 32 (concat from enc1)
        
        # Output
        self.out_conv = nn.Conv3d(f, out_channels, 1)

    def forward(self, x):
        # Encoder path
        e1 = self.enc1(x)          # (B, 32, D, H, W)
        e2 = self.enc2(self.pool(e1))   # (B, 64, D/2, H/2, W/2)
        e3 = self.enc3(self.pool(e2))   # (B, 128, D/4, H/4, W/4)
        e4 = self.enc4(self.pool(e3))   # (B, 256, D/8, H/8, W/8)
        
        # Decoder path with skip connections
        d3 = self.up3(e4)
        d3 = self._pad_and_cat(d3, e3)
        d3 = self.dec3(d3)
        
        d2 = self.up2(d3)
        d2 = self._pad_and_cat(d2, e2)
        d2 = self.dec2(d2)
        
        d1 = self.up1(d2)
        d1 = self._pad_and_cat(d1, e1)
        d1 = self.dec1(d1)
        
        return self.out_conv(d1)

    @staticmethod
    def _pad_and_cat(upsampled, skip):
        """Handle size mismatches from odd dimensions during pooling."""
        diff = [s - u for s, u in zip(skip.shape[2:], upsampled.shape[2:])]
        if any(d != 0 for d in diff):
            padding = []
            for d in reversed(diff):
                padding.extend([d // 2, d - d // 2])
            upsampled = nn.functional.pad(upsampled, padding)
        return torch.cat([upsampled, skip], dim=1)
