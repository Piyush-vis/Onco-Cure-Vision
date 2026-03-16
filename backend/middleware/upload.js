const multer = require('multer');
const path = require('path');

// Use absolute path for uploads directory
const uploadDir = path.join(__dirname, '..', 'uploads');

// Set storage engine
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'dicom-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Multer instance - accept any file for DICOM (relaxed for hackathon)
const upload = multer({
  storage: storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB limit
});

module.exports = upload;
