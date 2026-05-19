const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateAgeYears,
  assertClienteEdadMinima,
  formatDateOnly
} = require('../src/utils/clienteEdad');

test('calcula la edad exacta desde fecha_nacimiento', () => {
  assert.equal(
    calculateAgeYears('2005-05-19', new Date('2026-05-19T12:00:00')),
    21
  );
  assert.equal(
    calculateAgeYears('2006-05-19', new Date('2026-05-19T12:00:00')),
    20
  );
});

test('permite cliente con 21 años exactos para crédito', () => {
  const result = assertClienteEdadMinima(
    { fecha_nacimiento: '2005-05-19' },
    { referenceDate: new Date('2026-05-19T12:00:00'), requireFechaNacimiento: true }
  );

  assert.equal(result.edad, 21);
  assert.equal(formatDateOnly(result.fecha_nacimiento), '2005-05-19');
  assert.equal(result.eligible, true);
});

test('rechaza cliente menor de 21 años', () => {
  assert.throws(
    () => assertClienteEdadMinima(
      { fecha_nacimiento: '2006-05-19' },
      { referenceDate: new Date('2026-05-19T12:00:00'), requireFechaNacimiento: true }
    ),
    /No se pueden otorgar créditos a menores de 21 años/
  );
});

test('rechaza crédito cuando falta fecha_nacimiento', () => {
  assert.throws(
    () => assertClienteEdadMinima(
      {},
      { requireFechaNacimiento: true }
    ),
    /Debe registrar fecha_nacimiento antes de solicitar crédito/
  );
});

test('permite guardar cliente sin fecha_nacimiento cuando no es obligatoria', () => {
  const result = assertClienteEdadMinima(
    {},
    { requireFechaNacimiento: false }
  );

  assert.equal(result.eligible, true);
  assert.equal(result.edad, null);
});
