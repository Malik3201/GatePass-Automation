const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');

/** Target width for CNIC OCR — larger than before for small text. */
const OCR_WIDTH = 2000;
const FAST_OCR_WIDTH = 1350;

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function tmpPngPath(label) {
  return path.join(os.tmpdir(), `gatepass-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}-${label}.png`);
}

/**
 * Common pipeline: EXIF rotate, scale to ~2000px wide (or height), grayscale.
 * Pakistani CNIC front is portrait; fit inside keeps aspect ratio.
 */
function basePipeline(inputPath, targetWidth = OCR_WIDTH) {
  return sharp(inputPath)
    .rotate()
    .resize({
      width: targetWidth,
      height: targetWidth,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .grayscale();
}

/**
 * (a) Standard: normalize histogram + sharpen — good default for photos.
 */
async function variantNormal(inputPath) {
  const outPath = tmpPngPath('norm');
  await basePipeline(inputPath)
    .normalize({ lower: 2, upper: 98 })
    .sharpen({ sigma: 1, m1: 0.5, m2: 0.5, x1: 2, y2: 10, y3: 20 })
    .png()
    .toFile(outPath);
  return outPath;
}

/**
 * (b) Higher contrast: linear stretch + normalize — helps faint laser-print.
 */
async function variantHighContrast(inputPath) {
  const outPath = tmpPngPath('hi');
  await basePipeline(inputPath)
    .linear(1.55, -48)
    .normalize({ lower: 1, upper: 99 })
    .sharpen()
    .png()
    .toFile(outPath);
  return outPath;
}

/**
 * (c) Adaptive-style binarization: light blur to reduce speckle, then threshold.
 */
async function variantThreshold(inputPath) {
  const outPath = tmpPngPath('thr');
  await basePipeline(inputPath)
    .blur(0.65)
    .normalize({ lower: 3, upper: 97 })
    .threshold(158)
    .png()
    .toFile(outPath);
  return outPath;
}

/**
 * Build three temp PNGs for multi-pass OCR. Caller must delete all paths when done.
 */
async function createOcrVariantPaths(inputPath) {
  const paths = [];
  paths.push(await variantNormal(inputPath));
  paths.push(await variantHighContrast(inputPath));
  paths.push(await variantThreshold(inputPath));
  return paths;
}

/**
 * Backwards-compatible single preprocess (same as “normal” variant).
 * Prefer createOcrVariantPaths for new OCR flow.
 */
async function preprocessForOcr(inputPath) {
  return variantNormal(inputPath);
}

async function preprocessForOcrFast(inputPath) {
  const outPath = tmpPngPath('fast');
  await basePipeline(inputPath, FAST_OCR_WIDTH)
    .normalize({ lower: 2, upper: 98 })
    .sharpen({ sigma: 0.8, m1: 0.4, m2: 0.4, x1: 2, y2: 8, y3: 16 })
    .png()
    .toFile(outPath);
  return outPath;
}

module.exports = {
  preprocessForOcr,
  preprocessForOcrFast,
  createOcrVariantPaths,
  safeUnlink,
  OCR_WIDTH,
  FAST_OCR_WIDTH,
};
