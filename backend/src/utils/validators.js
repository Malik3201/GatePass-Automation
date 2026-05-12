/**
 * Basic string checks for API inputs (keep validation light for LAN / manual entry).
 */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function missingVisitorCreate(body) {
  const errors = [];
  if (!isNonEmptyString(body.visitor_name)) {
    errors.push('visitor_name is required');
  }
  if (!isNonEmptyString(body.cnic_no)) {
    errors.push('cnic_no is required');
  }
  return errors;
}

module.exports = {
  isNonEmptyString,
  missingVisitorCreate,
};
