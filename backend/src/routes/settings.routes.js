const express = require('express');
const settingsController = require('../controllers/settings.controller');

const router = express.Router();

router.get('/', settingsController.getAll);
router.post('/', settingsController.createOrUpdate);
router.put('/:key', settingsController.updateByKey);

module.exports = router;
