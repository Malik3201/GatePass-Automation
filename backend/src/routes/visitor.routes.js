const express = require('express');
const visitorController = require('../controllers/visitor.controller');
const {
  visitorPhotoUpload,
  cnicFrontUpload,
  cnicBackUpload,
} = require('../middleware/upload.middleware');

const router = express.Router();

/** Multer wrapper — turns upload errors into JSON API errors */
function handleUpload(mw) {
  return (req, res, next) => {
    mw.single('image')(req, res, (err) => {
      if (err) {
        err.status = 400;
        return next(err);
      }
      next();
    });
  };
}

// Specific paths first (so they are not treated as ":id")
router.post('/upload-photo', handleUpload(visitorPhotoUpload), visitorController.uploadPhoto);
router.post(
  '/upload-cnic-front',
  handleUpload(cnicFrontUpload),
  visitorController.uploadCnicFront
);
router.post('/upload-cnic-back', handleUpload(cnicBackUpload), visitorController.uploadCnicBack);

router.get('/', visitorController.list);
router.get('/:id', visitorController.getById);
router.post('/', visitorController.create);
router.put('/:id', visitorController.update);
router.patch('/:id/checkout', visitorController.checkout);
router.delete('/:id', visitorController.remove);

module.exports = router;
