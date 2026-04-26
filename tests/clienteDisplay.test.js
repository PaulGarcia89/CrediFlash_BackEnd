const test = require('node:test');
const assert = require('node:assert/strict');

const { buildClienteNombreCompleto } = require('../src/utils/clienteDisplay');

test('buildClienteNombreCompleto trims and joins name parts', () => {
  assert.equal(
    buildClienteNombreCompleto({ nombre: '  Mary ', apellido: ' Doria  ' }),
    'Mary Doria'
  );
});

test('buildClienteNombreCompleto returns null when there is no usable name', () => {
  assert.equal(buildClienteNombreCompleto({ nombre: '   ', apellido: null }), null);
});
