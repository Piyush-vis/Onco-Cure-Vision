const express = require('express');
const router = express.Router();
const { compareScans } = require('../controllers/comparisonController');
const { protect } = require('../middleware/auth');

router.post('/', protect, compareScans);

module.exports = router;
