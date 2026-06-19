"""
Mesh generator for brain tumor visualization.

Reads NIfTI files (brain_flair.nii and tumor_seg.nii) and generates
GLB meshes for the React Three Fiber 3D viewer.

Generates separate meshes for each tumor sub-region:
  - Brain (semi-transparent grey)
  - Necrotic core (label 1, dark purple)
  - Peritumoral edema (label 2, blue)
  - Enhancing tumor (label 4, red)

Usage:
    python mesh_generator.py <patient_folder> <output_filename.glb>
"""

import nibabel as nib
import numpy as np
from skimage import measure
import trimesh
import os
import sys


# ─── Mesh Colors (RGBA) ────────────────────────────────────
COLORS = {
    'brain':     [200, 200, 200, 80],    # Light grey, very transparent
    'necrotic':  [150, 50, 200, 255],     # Purple, solid
    'edema':     [50, 150, 255, 150],     # Blue, semi-transparent
    'enhancing': [255, 50, 50, 255],      # Red, solid
    'tumor':     [255, 50, 50, 255],      # Red fallback for combined tumor
}

# Mesh names used by the frontend to identify and style meshes
MESH_NAMES = {
    'brain': 'brain',
    'necrotic': 'tumor_necrotic',
    'edema': 'tumor_edema',
    'enhancing': 'tumor_enhancing',
    'tumor': 'tumor',
}


def create_mesh_from_mask(mask, color, step_size=1, smooth_iterations=5):
    """
    Create a triangle mesh from a binary mask using marching cubes.
    
    Args:
        mask: 3D boolean numpy array
        color: RGBA list [r, g, b, a]
        step_size: marching cubes step size (2 = coarser/faster, 1 = fine)
        smooth_iterations: number of Humphrey smoothing passes
    
    Returns:
        trimesh.Trimesh or None
    """
    if not np.any(mask):
        return None
    
    try:
        verts, faces, norms, _ = measure.marching_cubes(
            mask.astype(np.float32), 
            level=0.5,
            step_size=step_size
        )
        
        mesh = trimesh.Trimesh(
            vertices=verts, 
            faces=faces, 
            vertex_normals=norms
        )
        
        # Smooth the mesh for nicer appearance
        if smooth_iterations > 0:
            trimesh.smoothing.filter_humphrey(mesh, iterations=smooth_iterations)
        
        # Set color
        mesh.visual.face_colors = color
        
        return mesh
    except Exception as e:
        print(f"Warning: Could not generate mesh - {e}", file=sys.stderr)
        return None


def create_react_model(patient_folder, output_filename):
    """
    Generate GLB mesh file from NIfTI brain and segmentation volumes.
    
    Looks for:
        - *flair.nii / *flair.nii.gz  -> brain volume
        - *seg.nii / *seg.nii.gz      -> segmentation mask
    """
    print(f"1. Scanning patient folder: {patient_folder}")
    
    # Find the NIfTI files
    flair_file = None
    seg_file = None
    
    for file in os.listdir(patient_folder):
        fl = file.lower()
        if fl.endswith('flair.nii') or fl.endswith('flair.nii.gz'):
            flair_file = os.path.join(patient_folder, file)
        elif fl.endswith('seg.nii') or fl.endswith('seg.nii.gz'):
            seg_file = os.path.join(patient_folder, file)
    
    if not flair_file or not seg_file:
        print("Error: Could not find both the FLAIR and SEG files in the folder.")
        print(f"  Found files: {os.listdir(patient_folder)}")
        sys.exit(1)
    
    print("2. Loading medical volumes...")
    brain_data = nib.load(flair_file).get_fdata()
    tumor_data = nib.load(seg_file).get_fdata()
    
    meshes = []
    mesh_metadata = {}
    
    # ── Brain Mesh ──────────────────────────────────────────
    print("3. Generating Brain Mesh...")
    brain_mask = brain_data > 10  # Threshold to separate brain from background
    brain_mesh = create_mesh_from_mask(
        brain_mask, 
        color=COLORS['brain'], 
        step_size=2,          # Coarser for performance
        smooth_iterations=10
    )
    
    if brain_mesh:
        brain_mesh.metadata['name'] = MESH_NAMES['brain']
        meshes.append(brain_mesh)
        mesh_metadata['brain'] = True
    
    # ── Tumor Sub-Region Meshes ─────────────────────────────
    # BraTS labels: 1=necrotic, 2=edema, 4=enhancing
    
    has_subregions = False
    
    # Check if we have multi-class segmentation
    unique_labels = np.unique(tumor_data)
    print(f"   Segmentation labels found: {unique_labels}")
    
    if len(unique_labels) > 2:  # More than just 0 and one class
        has_subregions = True
        
        # Necrotic core (label 1)
        print("4a. Generating Necrotic Core Mesh...")
        necrotic_mask = tumor_data == 1
        necrotic_mesh = create_mesh_from_mask(
            necrotic_mask, COLORS['necrotic'], step_size=1, smooth_iterations=5
        )
        if necrotic_mesh:
            necrotic_mesh.metadata['name'] = MESH_NAMES['necrotic']
            meshes.append(necrotic_mesh)
            mesh_metadata['necrotic'] = True
        
        # Edema (label 2)
        print("4b. Generating Edema Mesh...")
        edema_mask = tumor_data == 2
        edema_mesh = create_mesh_from_mask(
            edema_mask, COLORS['edema'], step_size=1, smooth_iterations=5
        )
        if edema_mesh:
            edema_mesh.metadata['name'] = MESH_NAMES['edema']
            meshes.append(edema_mesh)
            mesh_metadata['edema'] = True
        
        # Enhancing tumor (label 4)
        print("4c. Generating Enhancing Tumor Mesh...")
        enhancing_mask = tumor_data == 4
        enhancing_mesh = create_mesh_from_mask(
            enhancing_mask, COLORS['enhancing'], step_size=1, smooth_iterations=5
        )
        if enhancing_mesh:
            enhancing_mesh.metadata['name'] = MESH_NAMES['enhancing']
            meshes.append(enhancing_mesh)
            mesh_metadata['enhancing'] = True
    
    # Also create a combined tumor mesh (all labels > 0)
    print("4d. Generating Combined Tumor Mesh...")
    combined_tumor_mask = tumor_data > 0
    combined_mesh = create_mesh_from_mask(
        combined_tumor_mask, COLORS['tumor'], step_size=1, smooth_iterations=5
    )
    if combined_mesh:
        combined_mesh.metadata['name'] = MESH_NAMES['tumor']
        if not has_subregions:
            # Only include combined mesh if we don't have sub-regions
            meshes.append(combined_mesh)
            mesh_metadata['tumor'] = True
    
    if len(meshes) == 0:
        print("Error: No meshes could be generated.")
        sys.exit(1)
    
    # ── Export as GLB ───────────────────────────────────────
    print("5. Combining and exporting for React...")
    scene = trimesh.Scene(meshes)
    scene.export(output_filename)
    
    print(f"Success! Generated {output_filename}")
    print(f"Meshes included: {list(mesh_metadata.keys())}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python mesh_generator.py <patient_folder> <output_filename.glb>")
        sys.exit(1)
    
    PATIENT_FOLDER = sys.argv[1]
    OUTPUT_FILE = sys.argv[2]
    
    create_react_model(PATIENT_FOLDER, OUTPUT_FILE)
