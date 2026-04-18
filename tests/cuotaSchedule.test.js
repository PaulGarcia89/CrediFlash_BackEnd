const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWeeklyDueDates,
  getNextFridayStrict,
  resolveWeeklyFirstDueDate,
  formatDateOnly
} = require('../src/utils/cuotaSchedule');

test('getNextFridayStrict moves Friday approvals to the following Friday', () => {
  const nextFriday = getNextFridayStrict(new Date('2026-04-17T10:00:00'));
  assert.equal(formatDateOnly(nextFriday), '2026-04-24');
});

test('resolveWeeklyFirstDueDate uses the next Friday when no explicit date is provided', () => {
  const firstDue = resolveWeeklyFirstDueDate({
    fechaInicio: new Date('2026-04-17T10:00:00')
  });

  assert.equal(formatDateOnly(firstDue), '2026-04-24');
});

test('buildWeeklyDueDates generates a weekly schedule from the next Friday', () => {
  const fechas = buildWeeklyDueDates({
    numSemanas: 4,
    fechaInicio: new Date('2026-04-17T10:00:00')
  });

  assert.deepEqual(
    fechas.map((fecha) => formatDateOnly(fecha)),
    ['2026-04-24', '2026-05-01', '2026-05-08', '2026-05-15']
  );
});

test('buildWeeklyDueDates keeps a valid explicit Friday when it is later than the approval date', () => {
  const fechas = buildWeeklyDueDates({
    numSemanas: 2,
    fechaInicio: new Date('2026-04-17T10:00:00'),
    fechaPrimerVencimiento: '2026-05-08'
  });

  assert.deepEqual(
    fechas.map((fecha) => formatDateOnly(fecha)),
    ['2026-05-08', '2026-05-15']
  );
});
