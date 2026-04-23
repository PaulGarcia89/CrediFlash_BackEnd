const test = require('node:test');
const assert = require('node:assert/strict');

const { applyWeeklyPaymentToQuotas } = require('../src/utils/weeklyPaymentApplication');

const buildQuotas = (totals) => totals.map((total, index) => ({
  id: `quota-${index + 1}`,
  monto_total: total,
  monto_pagado: 0,
  estado: 'PENDIENTE',
  monto_fee_acumulado: 0,
  monto_penalizacion_acumulada: 0,
  observaciones: null
}));

test('pago exacto deja saldo pendiente en cero y una cuota menos', () => {
  const result = applyWeeklyPaymentToQuotas({
    cuotas: buildQuotas([295, 295, 295]),
    montoPagoRecibido: 295
  });

  assert.equal(result.tipoAplicacion, 'COMPLETO');
  assert.equal(result.pagadoTotal, 295);
  assert.equal(result.saldoPendienteTotal, 590);
  assert.equal(result.cuotasRestantes, 2);
  assert.equal(result.pagosHechos, 1);
  assert.equal(result.cuotasActualizadas[0].estado, 'PAGADO');
});

test('pago parcial mantiene la cuota abierta y preserva el saldo real', () => {
  const result = applyWeeklyPaymentToQuotas({
    cuotas: buildQuotas([295, 295, 295]),
    montoPagoRecibido: 200
  });

  assert.equal(result.tipoAplicacion, 'PARCIAL');
  assert.equal(result.pagadoTotal, 200);
  assert.equal(result.saldoPendienteTotal, 685);
  assert.equal(result.cuotasRestantes, 3);
  assert.equal(result.pagosHechos, 0);
  assert.equal(result.cuotasActualizadas[0].estado, 'PENDIENTE');
  assert.equal(result.cuotasActualizadas[0].monto_pagado, 200);
});

test('pago adelantado aplica el excedente a la siguiente cuota', () => {
  const result = applyWeeklyPaymentToQuotas({
    cuotas: buildQuotas([295, 295, 295]),
    montoPagoRecibido: 400
  });

  assert.equal(result.tipoAplicacion, 'ADELANTADO');
  assert.equal(result.pagadoTotal, 400);
  assert.equal(result.saldoPendienteTotal, 485);
  assert.equal(result.cuotasRestantes, 2);
  assert.equal(result.pagosHechos, 1);
  assert.equal(result.cuotasActualizadas[0].estado, 'PAGADO');
  assert.equal(result.cuotasActualizadas[1].monto_pagado, 105);
});

test('pago exacto con penalización y fee ajusta el monto objetivo', () => {
  const result = applyWeeklyPaymentToQuotas({
    cuotas: buildQuotas([295, 295, 295]),
    montoPagoRecibido: 325,
    montoPenalizacion: 20,
    montoFee: 10,
    motivoFee: 'Mora'
  });

  assert.equal(result.tipoAplicacion, 'COMPLETO');
  assert.equal(result.pagadoTotal, 325);
  assert.equal(result.saldoPendienteTotal, 590);
  assert.equal(result.cuotasRestantes, 2);
  assert.equal(result.cuotasActualizadas[0].monto_total, 325);
  assert.equal(result.cuotasActualizadas[0].monto_penalizacion_acumulada, 20);
  assert.equal(result.cuotasActualizadas[0].monto_fee_acumulado, 10);
});

test('pago parcial con cargos mantiene el saldo pendiente correcto', () => {
  const result = applyWeeklyPaymentToQuotas({
    cuotas: buildQuotas([295, 295, 295]),
    montoPagoRecibido: 300,
    montoPenalizacion: 20,
    montoFee: 10
  });

  assert.equal(result.tipoAplicacion, 'PARCIAL');
  assert.equal(result.pagadoTotal, 300);
  assert.equal(result.saldoPendienteTotal, 615);
  assert.equal(result.cuotasRestantes, 3);
  assert.equal(result.cuotasActualizadas[0].monto_total, 325);
  assert.equal(result.cuotasActualizadas[0].monto_pagado, 300);
});
