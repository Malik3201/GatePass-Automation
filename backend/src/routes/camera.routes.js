const express = require('express');
const cameraController = require('../controllers/camera.controller');

const router = express.Router();

router.get('/snapshot-proxy', cameraController.snapshotProxy);
router.post('/capture', express.json(), cameraController.capture);
router.get('/test', cameraController.test);

module.exports = router;
