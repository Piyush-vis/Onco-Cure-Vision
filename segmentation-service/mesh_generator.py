import nibabel as nib
import numpy as np
from skimage import measure
import trimesh
import os
import sys

def create_react_model(patient_folder, output_filename):
    print(f"1. Scanning patient folder: {patient_folder}")
    
    # In BraTS, each patient folder has multiple MRI types. 
    # 'flair' shows the brain well, and 'seg' is the exact tumor mask.
    # We find the files dynamically based on their endings.
    flair_file = None
    seg_file = None
    
    for file in os.listdir(patient_folder):
        if file.endswith('flair.nii') or file.endswith('flair.nii.gz'):
            flair_file = os.path.join(patient_folder, file)
        elif file.endswith('seg.nii') or file.endswith('seg.nii.gz'):
            seg_file = os.path.join(patient_folder, file)
            
    if not flair_file or not seg_file:
        print("Error: Could not find both the FLAIR and SEG files in the folder.")
        # If testing with just one file or mock uploads we must handle this gracefully,
        # but for this script we just exit 1 to let Node.js know it failed.
        sys.exit(1)

    print("2. Loading medical volumes...")
    brain_data = nib.load(flair_file).get_fdata()
    tumor_data = nib.load(seg_file).get_fdata()

    print("3. Generating Brain Mesh...")
    # The brain is everything that isn't black background (value > 0)
    brain_mask = brain_data > 10 
    verts_b, faces_b, norms_b, _ = measure.marching_cubes(brain_mask, level=0.5)
    brain_mesh = trimesh.Trimesh(vertices=verts_b, faces=faces_b, vertex_normals=norms_b)
    
    # Make the brain light grey and semi-transparent (RGBA)
    brain_mesh.visual.face_colors = [200, 200, 200, 100] 

    print("4. Generating Tumor Mesh...")
    # The 'seg' file has values 1, 2, and 4 for different tumor parts. 
    # We grab the whole tumor by taking anything > 0.
    tumor_mask = tumor_data > 0
    
    meshes = [brain_mesh]
    
    # Only generate tumor mesh if there is a tumor
    if np.any(tumor_mask):
        try:
            verts_t, faces_t, norms_t, _ = measure.marching_cubes(tumor_mask, level=0.5)
            tumor_mesh = trimesh.Trimesh(vertices=verts_t, faces=faces_t, vertex_normals=norms_t)
            # Make the tumor bright, solid red
            tumor_mesh.visual.face_colors = [255, 50, 50, 255] 
            meshes.append(tumor_mesh)
        except Exception as e:
            print(f"Warning: Could not general tumor mesh - {e}")

    print("5. Combining and exporting for React...")
    # Combine both meshes into one scene
    scene = trimesh.Scene(meshes)
    
    # Export as a GLB file (perfect for the web)
    scene.export(output_filename)
    
    print(f"Success! Generated {output_filename}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python mesh_generator.py <patient_folder> <output_filename.glb>")
        sys.exit(1)
        
    PATIENT_FOLDER = sys.argv[1]
    OUTPUT_FILE = sys.argv[2]
    
    create_react_model(PATIENT_FOLDER, OUTPUT_FILE)
