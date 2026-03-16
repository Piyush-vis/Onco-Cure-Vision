import os
import sys
import json
import numpy as np
import pydicom
import nibabel as nib

# MOCK/PLACEHOLDER U-Net Inference for Aditya Jain's Brain Tumor Segmentation
# In a real environment, you would import torch/tensorflow and load your .h5/.pt weights here.

def load_dicom_series(folder_path):
    # Load all DICOM files in the folder
    slices = []
    for f in os.listdir(folder_path):
        if f.lower().endswith('.dcm'):
            try:
                ds = pydicom.dcmread(os.path.join(folder_path, f))
                slices.append(ds)
            except:
                pass
                
    if not slices:
        raise ValueError(f"No valid DICOM files found in {folder_path}")

    # Sort slices by ImagePositionPatient Z coordinate (or InstanceNumber)
    slices.sort(key=lambda x: float(x.ImagePositionPatient[2]) if hasattr(x, 'ImagePositionPatient') else x.InstanceNumber)

    # Convert to 3D numpy array
    image_3d = np.stack([s.pixel_array for s in slices])
    return image_3d, slices[0]

def predict_tumor(image_3d):
    # PREDICTION MOCK:
    # A real implementation would run image_3d through the U-net model.
    # We will generate a mock mask in the center of the brain volume.
    
    seg_3d = np.zeros_like(image_3d, dtype=np.uint8)
    
    z_center, y_center, x_center = [dim // 2 for dim in image_3d.shape]
    r = int(min(image_3d.shape) * 0.15) # 15% radius tumor
    
    # Draw a primitive sphere for the mock mask
    z, y, x = np.ogrid[-z_center:image_3d.shape[0]-z_center, 
                       -y_center:image_3d.shape[1]-y_center, 
                       -x_center:image_3d.shape[2]-x_center]
    mask = x*x + y*y + z*z <= r*r
    
    seg_3d[mask] = 1 # 1 represents the tumor class

    # Mock dynamic metadata based on "AI Confidence"
    confidence = round(np.random.uniform(85.0, 99.0), 1)
    
    # Classify based on some fake heuristic
    tumor_type = np.random.choice(['Meningioma', 'Glioma', 'Pituitary Tumor'])
    
    return seg_3d, confidence, tumor_type

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing input folder containing .dcm files"}))
        sys.exit(1)

    input_folder = sys.argv[1]
    
    try:
        # 1. Read DICOM
        image_3d, reference_dicom = load_dicom_series(input_folder)
        
        # 2. Run U-Net Prediction
        seg_3d, confidence, tumor_type = predict_tumor(image_3d)
        
        # 3. Save as NIfTI so mesh_generator.py can use it
        # Try to extract pixel spacing for proper affine scale
        affine = np.eye(4)
        if hasattr(reference_dicom, 'PixelSpacing'):
            affine[0, 0] = reference_dicom.PixelSpacing[0]
            affine[1, 1] = reference_dicom.PixelSpacing[1]
        if hasattr(reference_dicom, 'SliceThickness'):
            affine[2, 2] = reference_dicom.SliceThickness
            
        flair_img = nib.Nifti1Image(image_3d, affine)
        seg_img = nib.Nifti1Image(seg_3d, affine)
        
        flair_path = os.path.join(input_folder, 'brain_flair.nii')
        seg_path = os.path.join(input_folder, 'tumor_seg.nii')
        
        nib.save(flair_img, flair_path)
        nib.save(seg_img, seg_path)
        
        # 4. Output JSON metadata to stdout for the Node.js backend to capture
        result = {
            "success": True,
            "flair_path": flair_path,
            "seg_path": seg_path,
            "metadata": {
                "type": tumor_type,
                "confidence": confidence,
                "volume_cm3": round(np.sum(seg_3d) * (affine[0,0] * affine[1,1] * affine[2,2]) / 1000, 2),
                "enhancing": True if tumor_type == 'Meningioma' else False
            }
        }
        
        print(json.dumps(result))
        sys.exit(0)
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
