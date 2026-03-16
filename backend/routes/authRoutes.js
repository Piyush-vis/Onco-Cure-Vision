const express = require('express');
const { register, login, getMe } = require('../controllers/authController');

const router = express.Router();

const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
// Add put update details, password if needed

module.exports = router;
