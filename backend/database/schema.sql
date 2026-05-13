-- Gate Pass Automation — MySQL schema
-- Run as a user that can create databases, or create DB manually first.

CREATE DATABASE IF NOT EXISTS gatepass_automation
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gatepass_automation;

-- Main visitor / gate pass records (image paths only — no BLOBs)
CREATE TABLE IF NOT EXISTS visitors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pass_no VARCHAR(50) UNIQUE NOT NULL,
  visitor_name VARCHAR(150),
  cnic_no VARCHAR(30),
  father_name VARCHAR(150),
  mobile_no VARCHAR(30),
  company VARCHAR(150),
  person_to_meet VARCHAR(150),
  department VARCHAR(100),
  purpose VARCHAR(255),
  vehicle_no VARCHAR(50),
  gate_no VARCHAR(50),
  time_in DATETIME,
  time_out DATETIME NULL,
  remarks TEXT,
  visitor_photo_path VARCHAR(255),
  cnic_front_path VARCHAR(255),
  cnic_back_path VARCHAR(255),
  ocr_raw_text MEDIUMTEXT,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Simple key/value app settings (camera URLs, company name, etc.)
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default settings (INSERT IGNORE avoids errors if you re-run this block)
INSERT IGNORE INTO settings (setting_key, setting_value) VALUES
  ('COMPANY_NAME', 'THE MAGNUM ICE CREAM COMPANY'),
  ('GATE_NAME', 'Main Gate'),
  ('CAMERA_SNAPSHOT_URL', ''),
  ('CAMERA_STREAM_URL', ''),
  ('VISITOR_CAMERA_STREAM_URL', ''),
  ('VISITOR_CAMERA_SNAPSHOT_URL', ''),
  ('CNIC_CAMERA_STREAM_URL', ''),
  ('CNIC_CAMERA_SNAPSHOT_URL', ''),
  ('VISITOR_CAMERA_TYPE', 'ip'),
  ('CNIC_CAMERA_TYPE', 'ip'),
  ('VISITOR_USB_DEVICE_ID', ''),
  ('CNIC_USB_DEVICE_ID', ''),
  ('AUTO_CAPTURE_ENABLED', 'false'),
  ('AUTO_FACE_COUNTDOWN_SECONDS', '3'),
  ('AUTO_CNIC_COUNTDOWN_SECONDS', '3'),
  ('BACKUP_EXPORT_PATH', 'exports'),
  ('OCR_ENABLED', 'true'),
  ('OCR_FAST_MODE', 'true'),
  ('OCR_SECOND_PASS_ENABLED', 'false'),
  ('OCR_PYTHON_ENABLED', 'false'),
  ('OCR_PYTHON_BASE_URL', 'http://localhost:8001'),
  ('OCR_PYTHON_TIMEOUT_MS', '10000');
