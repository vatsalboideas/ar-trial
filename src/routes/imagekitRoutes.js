const express = require('express');
const {
  getImageKitAuth,
  scheduleDelete,
} = require('../controllers/imagekitController');

const router = express.Router();

router.get('/auth', getImageKitAuth);
router.post('/schedule-delete', scheduleDelete);

module.exports = router;
