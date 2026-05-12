const express = require('express');
const exportController = require('../controllers/export.controller');

const router = express.Router();

router.get('/daily', exportController.daily);

module.exports = router;
