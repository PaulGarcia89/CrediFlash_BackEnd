const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWeeklyDueDates,
  getNextFridayStrict,
  getFirstWeeklyDueDate,
  resolveWeeklyFirstDueDate,
  formatDateOnly
} = require('../src/utils/cuotaSchedule');

test('getNextFridayStrict keeps a seven-day offset', () => {
  const nextFriday = getNextFridayStrict(new Date('2026-04-17T10:00:00'));
  assert.equal(formatDateOnly(nextFriday), '2026-04-24');
});

test('getFirstWeeklyDueDate returns exactly seven days after disbursement', () => {
  const firstDue = getFirstWeeklyDueDate(new Date('2026-04-28T10:00:00'));

  assert.equal(formatDateOnly(firstDue), '2026-05-05');
});

test('resolveWeeklyFirstDueDate uses the exact seven-day rule when no explicit date is provided', () => {
  const firstDue = resolveWeeklyFirstDueDate({
    fechaInicio: new Date('2026-04-28T10:00:00')
  });

  assert.equal(formatDateOnly(firstDue), '2026-05-05');
});

test('buildWeeklyDueDates generates a weekly schedule from the exact seven-day first due date', () => {
  const fechas = buildWeeklyDueDates({
    numSemanas: 4,
    fechaInicio: new Date('2026-04-28T10:00:00')
  });

  assert.deepEqual(
    fechas.map((fecha) => formatDateOnly(fecha)),
    ['2026-05-05', '2026-05-12', '2026-05-19', '2026-05-26']
  );
});

test('buildWeeklyDueDates keeps an explicit date only when it matches the exact seven-day rule', () => {
  const fechas = buildWeeklyDueDates({
    numSemanas: 2,
    fechaInicio: new Date('2026-04-24T10:00:00'),
    fechaPrimerVencimiento: '2026-05-01'
  });

  assert.deepEqual(
    fechas.map((fecha) => formatDateOnly(fecha)),
    ['2026-05-01', '2026-05-08']
  );
});

test('buildWeeklyDueDates ignores explicit dates that do not match the seven-day rule', () => {
  const fechas = buildWeeklyDueDates({
    numSemanas: 4,
    fechaInicio: new Date('2026-04-28T10:00:00'),
    fechaPrimerVencimiento: '2026-05-01'
  });

  assert.deepEqual(
    fechas.map((fecha) => formatDateOnly(fecha)),
    ['2026-05-05', '2026-05-12', '2026-05-19', '2026-05-26']
  );
});
