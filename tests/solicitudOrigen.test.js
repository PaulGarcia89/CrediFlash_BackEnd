const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPublicSolicitudOrigin,
  buildInternalSolicitudOrigin,
  ORIGEN_SOLICITUD,
  CANAL_REGISTRO,
  SOURCE
} = require('../src/utils/solicitudOrigen');

test('buildPublicSolicitudOrigin fuerza EXTERNO aunque el payload diga otra cosa', () => {
  const result = buildPublicSolicitudOrigin({
    origen_solicitud: 'INTERNO',
    es_publica: false,
    es_externa: false,
    canal_registro: 'INTERNO',
    source: 'INTERNAL',
    solicitud_enviada_en: '2026-04-15T10:00:00.000Z',
    fecha_envio_solicitud: '2026-04-15T11:00:00.000Z'
  });

  assert.equal(result.origen_solicitud, ORIGEN_SOLICITUD.EXTERNO);
  assert.equal(result.es_publica, true);
  assert.equal(result.es_externa, true);
  assert.equal(result.canal_registro, CANAL_REGISTRO.EXTERNO);
  assert.equal(result.source, SOURCE.PUBLIC);
  assert.equal(result.origen, ORIGEN_SOLICITUD.EXTERNO);
  assert.ok(result.solicitud_enviada_en instanceof Date);
  assert.ok(result.fecha_envio_solicitud instanceof Date);
});

test('buildInternalSolicitudOrigin fuerza INTERNO', () => {
  const result = buildInternalSolicitudOrigin({
    origen_solicitud: 'EXTERNO',
    es_publica: true,
    es_externa: true,
    canal_registro: 'EXTERNO',
    source: 'PUBLIC'
  });

  assert.equal(result.origen_solicitud, ORIGEN_SOLICITUD.INTERNO);
  assert.equal(result.es_publica, false);
  assert.equal(result.es_externa, false);
  assert.equal(result.canal_registro, CANAL_REGISTRO.INTERNO);
  assert.equal(result.source, SOURCE.INTERNAL);
  assert.equal(result.origen, ORIGEN_SOLICITUD.INTERNO);
  assert.equal(result.solicitud_enviada_en, null);
  assert.equal(result.fecha_envio_solicitud, null);
});
