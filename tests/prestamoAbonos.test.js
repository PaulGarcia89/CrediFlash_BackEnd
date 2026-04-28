const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveLoanPaymentCounters,
  summarizeLoanQuotas
} = require('../src/utils/prestamoAbonos');

const buildCuotas = (items) => items.map((item, index) => ({
  id: `quota-${index + 1}`,
  monto_total: item.total,
  monto_pagado: item.pagado,
  estado: item.estado || 'PENDIENTE'
}));

test('resume cuotas completas y parciales desde el historial real', () => {
  const cuotas = buildCuotas([
    { total: 295, pagado: 295 },
    { total: 295, pagado: 200 },
    { total: 295, pagado: 0 }
  ]);

  const resumen = summarizeLoanQuotas(cuotas);

  assert.equal(resumen.pagosHechos, 1);
  assert.equal(resumen.cuotasRestantes, 2);
  assert.equal(resumen.saldoPendiente, 390);
  assert.equal(resumen.abonoParcialAcumulado, 200);
});

test('resolveLoanPaymentCounters prioriza las cuotas sobre los contadores almacenados', () => {
  const prestamo = {
    pagos_hechos: 19,
    pagos_pendientes: 101,
    pendiente: 100,
    abono_parcial_acumulado: 999,
    cuotas: buildCuotas([
      { total: 110, pagado: 110 },
      { total: 110, pagado: 110 },
      { total: 110, pagado: 50 },
      { total: 110, pagado: 0 }
    ])
  };

  const counters = resolveLoanPaymentCounters(prestamo);

  assert.equal(counters.pagosHechos, 2);
  assert.equal(counters.cuotasRestantes, 2);
  assert.equal(counters.saldoPendiente, 170);
  assert.equal(counters.abonoParcialAcumulado, 50);
});

test('resolveLoanPaymentCounters usa el monto pagado real aunque el estado esté desincronizado', () => {
  const prestamo = {
    cuotas: buildCuotas([
      { total: 295, pagado: 295, estado: 'PENDIENTE' },
      { total: 295, pagado: 200, estado: 'PAGADO' }
    ])
  };

  const counters = resolveLoanPaymentCounters(prestamo);

  assert.equal(counters.pagosHechos, 1);
  assert.equal(counters.cuotasRestantes, 1);
  assert.equal(counters.saldoPendiente, 95);
  assert.equal(counters.abonoParcialAcumulado, 200);
});

test('resolveLoanPaymentCounters cae a los contadores persistidos si no hay cuotas cargadas', () => {
  const counters = resolveLoanPaymentCounters({
    num_semanas: 4,
    pagos_hechos: 2,
    pagos_pendientes: 2,
    pendiente: 170,
    abono_parcial_acumulado: 50
  });

  assert.equal(counters.pagosHechos, 2);
  assert.equal(counters.cuotasRestantes, 2);
  assert.equal(counters.saldoPendiente, 170);
  assert.equal(counters.abonoParcialAcumulado, 50);
});
