const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateFlatLoanPricing,
  resolveInterestPercentageInput
} = require('../src/services/financial/loanPricingService');
const {
  formatDateOnly
} = require('../src/services/financial/scheduleService');

test('calcula préstamo semanal con cronograma y separación flat', () => {
  const financial = calculateFlatLoanPricing({
    montoOriginal: 1000,
    interesPorcentaje: 16,
    modalidad: 'SEMANAL',
    numeroCuotas: 4,
    fechaInicio: new Date('2026-04-28T10:00:00')
  });

  assert.equal(financial.monto_original, 1000);
  assert.equal(financial.interes_total, 160);
  assert.equal(financial.total_pagar, 1160);
  assert.equal(financial.valor_cuota, 290);
  assert.equal(financial.capital_por_cuota, 250);
  assert.equal(financial.interes_por_cuota, 40);
  assert.deepEqual(
    financial.cronograma.map((cuota) => formatDateOnly(cuota.fecha_vencimiento)),
    ['2026-05-05', '2026-05-12', '2026-05-19', '2026-05-26']
  );
});

test('calcula préstamo quincenal con fechas cada 15 días', () => {
  const financial = calculateFlatLoanPricing({
    montoOriginal: 1000,
    interesPorcentaje: 17,
    modalidad: 'QUINCENAL',
    numeroCuotas: 2,
    fechaInicio: new Date('2026-05-06T10:00:00')
  });

  assert.equal(financial.interes_total, 170);
  assert.equal(financial.total_pagar, 1170);
  assert.equal(financial.valor_cuota, 585);
  assert.deepEqual(
    financial.cronograma.map((cuota) => formatDateOnly(cuota.fecha_vencimiento)),
    ['2026-05-21', '2026-06-05']
  );
});

test('calcula préstamo mensual con fechas cada 1 mes', () => {
  const financial = calculateFlatLoanPricing({
    montoOriginal: 900,
    interesPorcentaje: 10,
    modalidad: 'MENSUAL',
    numeroCuotas: 3,
    fechaInicio: new Date('2026-05-06T10:00:00')
  });

  assert.equal(financial.interes_total, 90);
  assert.equal(financial.total_pagar, 990);
  assert.equal(financial.valor_cuota, 330);
  assert.equal(financial.capital_por_cuota, 300);
  assert.equal(financial.interes_por_cuota, 30);
  assert.deepEqual(
    financial.cronograma.map((cuota) => formatDateOnly(cuota.fecha_vencimiento)),
    ['2026-06-06', '2026-07-06', '2026-08-06']
  );
});

test('normaliza tasas legacy fraccionarias a porcentaje visible', () => {
  assert.equal(resolveInterestPercentageInput({ interesPorcentaje: 0.17 }), 17);
  assert.equal(resolveInterestPercentageInput({ interesPorcentaje: 17 }), 17);
});
