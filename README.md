# Onco-Cure Vision 🧠

An AI-powered neuroradiology platform designed to bridge the gap between complex medical imaging and accessible patient care. Onco-Cure Vision automatically segments brain tumors from MRI scans, providing interactive 3D visualizations and translating dense medical reports into both clinical and patient-friendly formats.

## ✨ Key Features

- **Interactive 3D Brain & Tumor Rendering**: Upload raw `DICOM` (`.dcm`) or `NIfTI` (`.nii`) MRI scans. The system automatically segments the tumor using a U-Net AI model and generates an interactive 3D view of the brain, tumor, and surrounding edema.
- **AI-Powered MRI Report Analysis**: Upload a standard MRI PDF report to instantly generate two distinct summaries using Google's Gemini AI:
  - 🩺 **Clinical Report**: A highly structured, professional summary with findings, impressions, and recommendations tailored for neurosurgeons and oncologists.
  - 🫂 **Patient-Friendly Report**: A compassionate, jargon-free explanation that translates medical terms into simple language, including relatable size comparisons (e.g., "the size of a grape").
- **Real-Time Analysis**: Extracts critical tumor characteristics including volume ($cm^3$), location, confidence scores, and morphological features (enhancing, necrotic, margins).
- **Role-Based Access**: Dedicated workflows and centralized scan histories for both medical professionals and patients.

---

## 🛠️ Tech Stack

**Frontend:**
- React (Vite)
- Three.js / React Three Fiber / Drei (for 3D rendering)
- Tailwind CSS

**Backend:**
- Node.js & Express
- MongoDB (Mongoose)
- Google Gemini AI (for report generation)
- Multer & PDF-Parse (for file handling)

**AI & Segmentation Service:**
- Python & Flask
- `pydicom` & `nibabel` (for medical image processing)
- `scikit-image` & `trimesh` (for 3D mesh generation)
- U-Net Architecture (for tumor segmentation)

---

## 🚀 Getting Started

To run this project locally, you will need to start all three modular services: the Backend, the Frontend, and the Python Segmentation Service.

### Prerequisites
- Node.js (v18+)
- Python (3.10+)
- MongoDB (Running locally or via MongoDB Atlas)
- Google Gemini AI API Key

### 1. Backend Setup (Node.js)
```bash
cd backend
npm install
```
Create a `.env` file in the `backend/` directory:
```env
PORT=8880
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
GEMINI_API_KEY=your_google_gemini_api_key
```
Start the server:
```bash
npm run dev
```

### 2. AI Segmentation Service Setup (Python)
```bash
cd segmentation-service
# It is recommended to create a virtual environment first
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

pip install -r requirements.txt
```
Start the Flask AI service (runs on port 8000 by default):
```bash
python app.py
```

### 3. Frontend Setup (React)
```bash
cd frontend
npm install
```
Start the Vite development server:
```bash
npm run dev
```

---

## 📂 Project Structure

- `/frontend` - The React application and 3D viewer components.
- `/backend` - The Express API, authentication, database models, and Gemini AI integration.
- `/segmentation-service` - Python scripts for DICOM parsing, U-Net inference (`predict_segmentation.py`), and GLB mesh generation (`mesh_generator.py`).
