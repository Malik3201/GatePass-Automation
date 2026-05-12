const fs = require('fs');
const Tesseract = require('tesseract.js');
const path = require('path');
const { createOcrVariantPaths, safeUnlink } = require('./image.service');
const { resolvePublicUploadPath } = require('../utils/fileHelpers');

/**
 * Pakistani CNIC front OCR — names depend on scan quality and NADRA layout.
 * Operators must always verify Name and CNIC; this module only suggests values.
 *
 * Manual fixture (expected behaviour):
 *   "a Abdul Rehman BS"
 *   "Father Name Ta gataly"
 *   "Muhammad Nawaz Malik E"
 *   "34501-3255376-1"
 * → visitor_name: Abdul Rehman, father_name: Muhammad Nawaz Malik, cnic: 34501-3255376-1
 */

const CNIC_FORMATTED = /\b(\d{5})-(\d{7})-(\d)\b/;

const COMMON_NAME_PREFIXES = [
  'muhammad',
  'mohammad',
  'mohammed',
  'ahmed',
  'ahmad',
  'ali',
  'abdul',
  'malik',
  'syed',
  'shah',
  'hassan',
  'hussain',
  'hamza',
  'usman',
  'umar',
  'bilal',
  'rehman',
  'rahman',
  'ayesha',
  'fatima',
  'noor',
];

const IGNORED_PHRASES_FOR_LINE = [
  'pakistan',
  'national identity card',
  'islamic republic',
  'government',
  'nadra',
  'identity number',
  'date of birth',
  'date of issue',
  'date of expiry',
  'dateof',
  'gender',
  'country of stay',
  'country',
  'signature',
  'holder',
  'card',
  'issue',
  'expiry',
  'birth',
  'male',
  'female',
  'sample',
  'specimen',
];

function hasUrduOrArabicScript(line) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(line);
}

function formatThirteenDigits(digits) {
  if (!digits || digits.length !== 13) return '';
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

function normalizeOcrLine(line) {
  if (!line) return '';
  let s = String(line).trim();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^[^A-Za-z0-9]+/, '');
  s = s.replace(/[^A-Za-z0-9\s.'-]+$/, '');
  s = s.replace(/[^A-Za-z0-9\s.'-]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function cleanNameCandidate(line) {
  let s = normalizeOcrLine(line);
  if (!s) return '';
  const parts = s.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';

  while (parts.length > 1) {
    const first = parts[0].replace(/[^A-Za-z]/g, '');
    if (first.length === 1 && /^[A-Za-z]$/.test(first)) parts.shift();
    else break;
  }

  const junkTail = new Set(['BS', 'TA', 'EA', 'ERE', 'E', 'I', 'G', 'A', 'Y', 'K']);
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    const core = last.replace(/[^A-Za-z]/g, '');
    if (core.length === 1 && /^[A-Za-z]$/.test(core)) {
      parts.pop();
      continue;
    }
    if (core.length <= 2 && junkTail.has(core.toUpperCase())) {
      parts.pop();
      continue;
    }
    break;
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function isGarbageLine(line) {
  const t = (line || '').trim();
  if (t.length < 3) return true;
  if (!/[A-Za-z]/.test(t)) return true;

  const nonAlnum = (t.match(/[^A-Za-z0-9\s.'-]/g) || []).length;
  if (nonAlnum > t.length * 0.35) return true;

  const words = t.split(/\s+/).filter(Boolean);
  const alphaWords = words.map((w) => w.replace(/[^A-Za-z]/g, '')).filter(Boolean);
  const longWords = alphaWords.filter((w) => w.length >= 3);
  if (alphaWords.length && longWords.length === 0) return true;

  let shortTok = 0;
  for (const w of alphaWords) {
    if (w.length <= 2) shortTok += 1;
  }
  if (alphaWords.length >= 2 && shortTok >= alphaWords.length - 1) return true;

  if (/^y\s+as\s+/i.test(t)) return true;
  if (/^ya\s+wn/i.test(t)) return true;

  return false;
}

function isIgnoredCnicLine(line) {
  const t = (line || '').trim();
  if (!t) return true;
  const lower = t.toLowerCase();

  if (/^name\s*:?\s+[a-z]/i.test(line)) return false;
  if (/^father\s*name\s*:?\s+[a-z]/i.test(line)) return false;
  if (/^husband\s*name\s*:?\s+[a-z]/i.test(line)) return false;

  if (/^name\s*:?\s*$/i.test(t)) return true;
  if (/^cnic\s*:?\s*$/i.test(t)) return true;
  if (/^father\s*name\s*:?\s*$/i.test(t)) return true;
  if (/^husband\s*name\s*:?\s*$/i.test(t)) return true;

  for (const p of IGNORED_PHRASES_FOR_LINE) {
    if (lower.includes(p)) return true;
  }

  return false;
}

function isDateLikeLine(line) {
  return /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(line);
}

function lineHasCnicPattern(line) {
  return CNIC_FORMATTED.test(line) || /\d{13}/.test(line.replace(/\D/g, ''));
}

function isLikelyHumanName(line) {
  const t = cleanNameCandidate(line);
  if (!t || t.length < 3 || t.length > 120) return false;
  if (isGarbageLine(t)) return false;
  if (isIgnoredCnicLine(t)) return false;
  if (isDateLikeLine(t)) return false;
  if (lineHasCnicPattern(t)) return false;
  if (hasUrduOrArabicScript(t)) return false;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;

  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  if (digits > 2 || digits > letters * 0.35) return false;

  const alphaWords = words.map((w) => w.replace(/[^A-Za-z]/g, '')).filter(Boolean);
  if (!alphaWords.some((w) => w.length >= 3)) return false;

  let okWords = 0;
  for (const w of alphaWords) {
    if (w.length >= 2) okWords += 1;
  }
  if (okWords < Math.ceil(alphaWords.length * 0.51)) return false;

  if (!/^[A-Za-z]/.test(t)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9\s.'-]*$/i.test(t);
}

function nameLabelProximity(lines, idx) {
  let best = 99;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^father\s*name|^husband\s*name/i.test(l)) continue;
    if (/^name\b/i.test(l)) {
      const d = Math.abs(idx - i);
      if (d < best) best = d;
    }
  }
  return best;
}

function fatherLabelProximity(lines, idx) {
  let best = 99;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^father\s*name|^husband\s*name/i.test(l)) {
      const d = Math.abs(idx - i);
      if (d < best) best = d;
    }
  }
  return best;
}

function getNameScore(line, lines, lineIndex, mode) {
  const t = cleanNameCandidate(line);
  if (!t || !isLikelyHumanName(t)) return -9999;
  if (isGarbageLine(t)) return -9999;

  let score = 5;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 3) score += 4;
  if (words.length === 4 || words.length === 5) score += 3;

  const proxName = nameLabelProximity(lines, lineIndex);
  const proxFather = fatherLabelProximity(lines, lineIndex);

  if (mode === 'visitor') {
    if (proxName <= 5) score += Math.max(0, 6 - proxName);
    if (proxFather <= 2 && proxName > proxFather + 1) score -= 4;
  } else {
    if (proxFather <= 5) score += Math.max(0, 6 - proxFather);
    if (proxName <= 1 && proxFather > 2) score -= 2;
  }

  const lower = t.toLowerCase();
  for (const p of COMMON_NAME_PREFIXES) {
    if (lower.startsWith(`${p} `) || lower === p) {
      score += 2;
      break;
    }
  }

  if (words.length === 1 && words[0].replace(/[^A-Za-z]/g, '').length <= 4) score -= 3;
  if ((t.match(/[^A-Za-z\s.'-]/g) || []).length > 2) score -= 3;

  return score;
}

function scoreToConfidence(score) {
  if (score < -1000) return 'none';
  if (score >= 12) return 'high';
  if (score >= 8) return 'medium';
  return 'low';
}

/** Father / husband: same-line value or lines shortly after a standalone label. */
function buildFatherCandidates(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const m1 = raw.match(/^father\s*name\s*:?\s*(.+)$/i);
    if (m1) {
      const t = cleanNameCandidate(m1[1]);
      if (t && isLikelyHumanName(t)) {
        out.push({ text: t, index: i });
      } else {
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const t2 = cleanNameCandidate(lines[j]);
          if (t2) out.push({ text: t2, index: j });
        }
      }
    }
    const m2 = raw.match(/^husband\s*name\s*:?\s*(.+)$/i);
    if (m2) {
      const t = cleanNameCandidate(m2[1]);
      if (t && isLikelyHumanName(t)) {
        out.push({ text: t, index: i });
      } else {
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const t2 = cleanNameCandidate(lines[j]);
          if (t2) out.push({ text: t2, index: j });
        }
      }
    }
    if (/^father\s*name\s*:?\s*$/i.test(raw.trim()) || /^husband\s*name\s*:?\s*$/i.test(raw.trim())) {
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const t = cleanNameCandidate(lines[j]);
        if (t) out.push({ text: t, index: j });
      }
    }
  }
  return out;
}

/** Visitor: Name: value same line, whole cleaned lines, and lines after a lone "Name" label. */
function buildVisitorCandidates(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^father\s*name|^husband\s*name/i.test(raw)) continue;

    const m = raw.match(/^name\s*:?\s*(.+)$/i);
    if (m) {
      const rest = cleanNameCandidate(m[1]);
      if (rest && !/^father|^husband/i.test(rest)) out.push({ text: rest, index: i });
    }

    if (!/^name\s*:?\s*$/i.test(raw.trim())) {
      const whole = cleanNameCandidate(raw);
      if (whole) out.push({ text: whole, index: i });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (!/^name\s*:?\s*$/i.test(lines[i].trim())) continue;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      if (/^father\s*name|^husband\s*name/i.test(lines[j])) break;
      const t = cleanNameCandidate(lines[j]);
      if (t) out.push({ text: t, index: j });
    }
  }
  return out;
}

function pickBestFather(lines) {
  const cands = buildFatherCandidates(lines);
  let best = { text: '', score: -9999 };
  for (const c of cands) {
    if (!isLikelyHumanName(c.text)) continue;
    const sc = getNameScore(c.text, lines, c.index, 'father');
    if (sc > best.score) best = { text: c.text, score: sc };
  }
  return best;
}

function pickBestVisitor(lines, fatherName) {
  const cands = buildVisitorCandidates(lines);
  const fl = (fatherName || '').trim().toLowerCase();
  let best = { text: '', score: -9999 };
  for (const c of cands) {
    if (!isLikelyHumanName(c.text)) continue;
    if (fl && c.text.toLowerCase() === fl) continue;
    const sc = getNameScore(c.text, lines, c.index, 'visitor');
    if (sc > best.score) best = { text: c.text, score: sc };
  }
  return best;
}

function extractPakistaniCnicFields(rawText, cleanedLines) {
  const { cnic: cnic_no, confidence: cnic_confidence } = extractCnicWithConfidence(rawText);

  const fatherBest = pickBestFather(cleanedLines);
  let father_name = fatherBest.text;
  let father_conf = fatherBest.text ? scoreToConfidence(fatherBest.score) : 'none';

  const visitorBest = pickBestVisitor(cleanedLines, father_name);
  let visitor_name = visitorBest.text;
  let visitor_conf = visitorBest.text ? scoreToConfidence(visitorBest.score) : 'none';

  if (visitor_name && father_name && visitor_name.toLowerCase() === father_name.toLowerCase()) {
    father_name = '';
    father_conf = 'none';
  }

  return {
    visitor_name: visitor_name || '',
    father_name: father_name || '',
    cnic_no: cnic_no || '',
    confidence: {
      visitor_name: visitor_name ? visitor_conf : 'none',
      father_name: father_name ? father_conf : 'none',
      cnic_no: cnic_no ? cnic_confidence : 'none',
    },
  };
}

function extractCnicWithConfidence(text) {
  if (!text || !String(text).trim()) {
    return { cnic: '', confidence: 'none' };
  }

  const m1 = text.match(CNIC_FORMATTED);
  if (m1) {
    return { cnic: `${m1[1]}-${m1[2]}-${m1[3]}`, confidence: 'high' };
  }

  const digitsOnly = text.replace(/\D/g, '');
  const m2 = digitsOnly.match(/(\d{13})/);
  if (m2) {
    return { cnic: formatThirteenDigits(m2[1]), confidence: 'medium' };
  }

  return { cnic: '', confidence: 'none' };
}

function extractCnicFromText(text) {
  return extractCnicWithConfidence(text).cnic;
}

function cleanOcrText(text) {
  if (!text) return '';
  const rawLines = String(text).split(/\r?\n/);
  const out = [];
  for (let line of rawLines) {
    line = line.trim();
    if (!line) continue;
    line = line.replace(/\s+/g, ' ');
    line = line.replace(/[^A-Za-z0-9\-/.\s']/g, ' ');
    line = line.replace(/\s+/g, ' ').trim();
    if (line) out.push(line);
  }
  return out.join('\n');
}

function getCleanedLines(text) {
  const s = cleanOcrText(text);
  if (!s) return [];
  return s.split('\n').map((l) => l.trim()).filter(Boolean);
}

async function recognizeToText(imagePath) {
  const {
    data: { text },
  } = await Tesseract.recognize(imagePath, 'eng', {
    logger: () => {},
  });
  return text || '';
}

function scoreOcrCandidate(rawText) {
  const cleaned = getCleanedLines(cleanOcrText(rawText));
  const { cnic } = extractCnicWithConfidence(rawText);
  let score = cleaned.length * 8 + Math.min(String(rawText).length, 6000) * 0.04;
  if (cnic) score += 450;
  if (CNIC_FORMATTED.test(rawText)) score += 150;
  return score;
}

async function runOcrOnFile(imageAbsPath) {
  const variantPaths = await createOcrVariantPaths(imageAbsPath);
  const texts = [];
  try {
    for (const p of variantPaths) {
      const t = await recognizeToText(p);
      texts.push(t);
    }
  } finally {
    variantPaths.forEach(safeUnlink);
  }

  let bestText = texts[0] || '';
  let bestScore = -1;
  for (const t of texts) {
    const sc = scoreOcrCandidate(t);
    if (sc > bestScore) {
      bestScore = sc;
      bestText = t;
    }
  }

  const rawText = bestText;
  const cleanedLines = getCleanedLines(cleanOcrText(rawText));
  const extracted = extractPakistaniCnicFields(rawText, cleanedLines);

  return {
    success: true,
    extracted: {
      visitor_name: extracted.visitor_name,
      father_name: extracted.father_name,
      cnic_no: extracted.cnic_no,
    },
    confidence: extracted.confidence,
    rawText,
    cleanedLines,
  };
}

async function ocrFromPublicPath(imagePath) {
  const abs = resolvePublicUploadPath(imagePath);
  if (!abs || !fs.existsSync(abs)) {
    const err = new Error('Invalid imagePath or file not found under /uploads');
    err.status = 400;
    throw err;
  }
  return runOcrOnFile(abs);
}

async function ocrFromUploadedFile(file) {
  if (!file || !file.path) {
    const err = new Error('No image file uploaded');
    err.status = 400;
    throw err;
  }
  const dateFolder = path.basename(path.dirname(file.path));
  const filename = path.basename(file.path);
  const publicPath = `/uploads/cnic-front/${dateFolder}/${filename}`.replace(/\\/g, '/');

  const ocr = await runOcrOnFile(file.path);
  return {
    ...ocr,
    imagePath: publicPath,
    filename,
  };
}

module.exports = {
  ocrFromPublicPath,
  ocrFromUploadedFile,
  extractCnicFromText,
  cleanOcrText,
  getCleanedLines,
  normalizeOcrLine,
  cleanNameCandidate,
  extractPakistaniCnicFields,
};
