# Onco-Cure Vision 🧠

An AI-powered neuroradiology platform that segments brain tumors from MRI scans using a custom-trained **3D U-Net deep learning model**, provides interactive 3D visualizations with multi-class tumor sub-regions, and translates dense medical reports into both clinical and patient-friendly formats using Google Gemini AI.

## ✨ Key Features

- **Real 3D U-Net Brain Tumor Segmentation**: Upload raw `NIfTI` (`.nii` / `.nii.gz`) MRI scans. The system runs a trained 3D U-Net model on GPU to segment three tumor sub-regions — necrotic core, peritumoral edema, and enhancing tumor — achieving a **Dice score of 0.66** on the BraTS2020 dataset.
- **Multi-Class 3D Visualization**: Interactive 3D rendering with color-coded tumor sub-regions:
  - 🟣 **Necrotic Core** (purple)
  - 🔵 **Peritumoral Edema** (blue, semi-transparent)
  - 🔴 **Enhancing Tumor** (red)
  - 🧠 **Brain** (grey, transparent)
  - Each sub-region can be toggled on/off independently.
- **AI-Powered MRI Report Analysis**: Upload a standard MRI PDF report to instantly generate two distinct summaries using Gemini AI:
  - 🩺 **Clinical Report**: A highly structured, professional summary with findings, impressions, and recommendations tailored for neurosurgeons and oncologists.
  - 🫂 **Patient-Friendly Report**: A compassionate, jargon-free explanation that translates medical terms into simple language, including relatable size comparisons (e.g., "the size of a grape").
- **Real-Time Tumor Analysis**: Extracts critical tumor characteristics including volume ($cm^3$), anatomical location, confidence scores, tumor type classification (HGG/LGG/GBM), and morphological features.
- **Role-Based Access**: Dedicated workflows and centralized scan histories for both medical professionals and patients.

---

## 🧠 ML Model — 3D U-Net Algorithm 

### Architecture
The segmentation model is a **3D U-Net** designed for volumetric brain tumor segmentation:

| Component | Details |
|-----------|---------|
| **Input** | 4-channel MRI (T1, T1ce, T2, FLAIR) — `128×128×128` crops |
| **Output** | 4-class segmentation map (Background, Necrotic, Edema, Enhancing) |
| **Encoder** | 4 levels: 32 → 64 → 128 → 256 channels with 3D convolutions + MaxPool |
| **Decoder** | Transposed convolutions + skip connections |
| **Parameters** | ~5.6M |
| **Framework** | PyTorch (CUDA accelerated) |

### Training
| Setting | Value |
|---------|-------|
| **Dataset** | BraTS2020 (369 patients, 314 train / 55 val) |
| **Loss** | Dice Loss + Cross-Entropy (combined) |
| **Optimizer** | Adam (lr=1e-4) |
| **LR Schedule** | Cosine Annealing |
| **Mixed Precision** | Yes (AMP / FP16) |
| **Early Stopping** | Patience = 5 epochs |
| **Training Time** | ~83 min on RTX 4060 (8GB VRAM) |

### Results
| Metric | Score |
|--------|-------|
| **Mean Dice Score** | **0.6578** |
| Necrotic Core (NCR) | 0.598 |
| Peritumoral Edema (ED) | **0.755** |
| Enhancing Tumor (ET) | 0.621 |
| Epochs | 19/20 (early stopped) |

### Inference Pipeline
1. Load 4-modality NIfTI files (T1, T1ce, T2, FLAIR)
2. Normalize each modality (zero-mean, unit-variance)
3. Run sliding-window inference on GPU with overlapping patches
4. Generate per-voxel segmentation mask via argmax on softmax probabilities
5. Extract metadata: tumor type, volume, location, confidence, margins
6. Generate multi-class 3D mesh (`.glb`) using marching cubes algorithm

---

## 🛠️ Tech Stack

**Frontend:**
- React 19 (Vite 8)
- Three.js / React Three Fiber / Drei (3D rendering)
- Tailwind CSS
- Axios (API communication)

**Backend:**
- Node.js & Express
- MongoDB Atlas (Mongoose ODM)
- Google Gemini AI (report generation)
- Multer (file upload) & PDF-Parse (PDF text extraction)
- JWT Authentication
- Child Process (spawns Python for ML inference)

**AI & Segmentation Service:**
- Python 3.13 & Flask
- PyTorch 2.6 (CUDA 12.4)
- `nibabel` (NIfTI/medical image I/O)
- `scikit-image` (marching cubes for mesh generation)
- `trimesh` (3D mesh processing & GLB export)
- `scipy` (image processing & interpolation)
- `pydicom` (DICOM support)

**Infrastructure:**
- MongoDB Atlas (cloud database)
- NVIDIA GPU (RTX 4060 — training & inference)
- Vite Dev Server with proxy (API forwarding)

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌──────────────────────────┐
│    Frontend      │     │      Backend          │     │  Segmentation Service    │
│  React + Vite    │────▶│  Node.js + Express    │────▶│  Python + PyTorch        │
│  Port: 5179      │◀────│  Port: 8880           │◀────│  (child process)         │
│                  │     │                       │     │                          │
│  • Three.js 3D   │     │  • JWT Auth           │     │  • 3D U-Net (CUDA)       │
│  • File Upload   │     │  • Multer Upload      │     │  • predict_segmentation  │
│  • Report View   │     │  • Gemini AI Reports  │     │  • mesh_generator        │
│  • Tumor Toggles │     │  • Scan Management    │     │  • Flask API             │
└─────────────────┘     └──────────┬───────────┘     └──────────────────────────┘
                                   │
                          ┌────────▼────────┐
                          │   MongoDB Atlas  │
                          │   + File Storage │
                          └─────────────────┘
```

**Data Flow:**
1. User uploads NIfTI MRI scans via frontend
2. Backend saves files, spawns Python child process
3. Python loads the trained 3D U-Net, runs GPU inference
4. Segmentation mask → marching cubes → GLB mesh file
5. Metadata (volume, type, confidence) returned as JSON
6. Backend saves results to MongoDB, serves mesh
7. Frontend renders interactive 3D visualization

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Python (3.10+)
- NVIDIA GPU with CUDA support (for training/inference)
- MongoDB (local or MongoDB Atlas)
- Google Gemini AI API Key

### 1. Backend Setup
```bash
cd backend
npm install
```
Create a `.env` file in `backend/`:
```env
PORT=8880
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
GEMINI_API_KEY=your_google_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
PYTHON_EXECUTABLE=path/to/segmentation-service/venv/Scripts/python.exe
FRONTEND_URL=http://localhost:5179
```
Start the server:
```bash
npm start
```

### 2. AI Segmentation Service Setup
```bash
cd segmentation-service
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux/Mac

# Install PyTorch with CUDA
pip install torch --index-url https://download.pytorch.org/whl/cu124

# Install remaining dependencies
pip install -r requirements.txt
```

#### Training the Model (Optional)
Download the [BraTS2020 dataset](https://www.med.upenn.edu/cbica/brats2020/data.html) to `segmentation-service/Dataset/MICCAI_BraTS2020_TrainingData/`, then:
```bash
python train_unet.py
```
Training takes ~83 min on an RTX 4060. The best model is saved to `models/best_model.pth`.

#### Running the Flask Service
```bash
python app.py
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
The app will be available at `http://localhost:5179/`.

---

## 📂 Project Structure

```
Onco-Cure-Vision/
├── frontend/                    # React application
│   ├── src/
│   │   ├── components/
│   │   │   └── viewer3d/
│   │   │       └── BrainViewer.jsx    # 3D tumor visualization
│   │   ├── pages/                     # Login, Register, Dashboard
│   │   ├── services/                  # API service layer
│   │   └── utils/constants.js         # API configuration
│   └── vite.config.js                 # Vite + proxy config
│
├── backend/                     # Express API server
│   ├── controllers/
│   │   ├── scanController.js          # MRI upload + ML inference
│   │   ├── reportController.js        # PDF parsing + Gemini reports
│   │   └── authController.js          # JWT authentication
│   ├── models/                        # MongoDB schemas
│   ├── routes/                        # API routes
│   ├── services/
│   │   └── geminiService.js           # Google Gemini integration
│   └── server.js
│
├── segmentation-service/        # Python ML pipeline
│   ├── unet3d.py                      # 3D U-Net architecture
│   ├── train_unet.py                  # Training script (BraTS2020)
│   ├── predict_segmentation.py        # Inference + metadata extraction
│   ├── mesh_generator.py              # Marching cubes → GLB mesh
│   ├── app.py                         # Flask API
│   ├── models/
│   │   └── best_model.pth             # Trained model weights (~67MB)
│   └── requirements.txt
│
└── README.md
```

---

## 📊 Sample Output

When a BraTS patient scan is uploaded, the system produces:

| Field | Example Value |
|-------|---------------|
| Tumor Type | High-Grade Glioma (HGG) |
| Confidence | 93.8% |
| Volume | 87.14 cm³ |
| Location | Midline Temporal |
| Enhancing | Present |
| Necrotic | Present |
| Edema | Present |
| Margins | Well-defined |
| 3D Mesh | 3.81 MB GLB (brain + 3 tumor sub-regions) |
