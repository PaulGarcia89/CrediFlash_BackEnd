const { formatMMDDYYYY } = require('./dateFormat');

const ISO_DATE_LIKE_REGEX = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/;

function normalizeDateValue(value) {
  if (value instanceof Date) {
    return formatMMDDYYYY(value);
  }

  if (typeof value === 'string' && ISO_DATE_LIKE_REGEX.test(value)) {
    return formatMMDDYYYY(value);
  }

  return value;
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const normalizedValue = normalizeDateValue(value);
  const stringValue = String(normalizedValue);
  const escapedValue = stringValue.replace(/"/g, '""');
  return `"${escapedValue}"`;
}

function toCsv(headers, rows) {
  const headerLine = headers.map((header) => escapeCsvValue(header.label)).join(',');
  const dataLines = rows.map((row) =>
    headers.map((header) => escapeCsvValue(row[header.key])).join(',')
  );

  return [headerLine, ...dataLines].join('\n');
}

function sendCsv(res, { filename, headers, rows }) {
  const csv = toCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(csv);
}

module.exports = {
  sendCsv
};
