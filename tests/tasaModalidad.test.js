const test = require('node:test');
const assert = require('node:assert/strict');

const { calcularTasaEfectivaPorModalidad } = require('../src/utils/tasaModalidad');

test('SEMANAL mantiene la tasa base', () => {
  const result = calcularTasaEfectivaPorModalidad({
    modalidad: 'SEMANAL',
    tasaBase: 0.12,
    plazoSemanas: 24
  });

  assert.equal(result.modalidad, 'SEMANAL');
  assert.equal(result.tasa_base, 0.12);
  assert.equal(result.tasa_variable, 0.12);
});

test('QUINCENAL duplica la tasa base', () => {
  const result = calcularTasaEfectivaPorModalidad({
    modalidad: 'QUINCENAL',
    tasaBase: 0.12,
    plazoSemanas: 24
  });

  assert.equal(result.modalidad, 'QUINCENAL');
  assert.equal(result.tasa_base, 0.12);
  assert.equal(result.tasa_variable, 0.24);
});

test('MENSUAL divide tasa base por meses calculados desde plazo_semanas', () => {
  const result = calcularTasaEfectivaPorModalidad({
    modalidad: 'MENSUAL',
    tasaBase: 0.12,
    plazoSemanas: 10
  });

  // ceil(10 / 4) = 3
  assert.equal(result.modalidad, 'MENSUAL');
  assert.equal(result.tasa_base, 0.12);
  assert.equal(result.tasa_variable, 0.04);
});

test('Lanza error para modalidad inválida', () => {
  assert.throws(
    () =>
      calcularTasaEfectivaPorModalidad({
        modalidad: 'DIARIA',
        tasaBase: 0.12,
        plazoSemanas: 8
      }),
    /modalidad inválida/
  );
});
