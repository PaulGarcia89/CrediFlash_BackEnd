function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
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
