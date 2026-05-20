const test = require('node:test');
const assert = require('node:assert/strict');

const { formatMMDDYYYY, parseDateSafe } = require('../src/utils/dateFormat');
const { parseFlexibleDate, formatDateOnly } = require('../src/services/financial/scheduleService');

test('formatMMDDYYYY preserves date-only values without timezone drift', () => {
  assert.equal(formatMMDDYYYY('2026-04-02'), '04/02/2026');
  assert.equal(formatMMDDYYYY('2026-04-02T00:00:00.000Z'), '04/02/2026');
});

test('parseDateSafe returns the intended calendar day for ISO date strings', () => {
  const date = parseDateSafe('2026-04-02');
  assert.equal(formatMMDDYYYY(date), '04/02/2026');
});

test('parseFlexibleDate keeps Excel-style date-only inputs stable', () => {
  const date = parseFlexibleDate('2026-04-02');
  assert.equal(formatDateOnly(date), '2026-04-02');
});
