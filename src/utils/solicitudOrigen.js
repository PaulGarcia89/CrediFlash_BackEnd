const ORIGEN_SOLICITUD = Object.freeze({
  EXTERNO: 'EXTERNO',
  INTERNO: 'INTERNO'
});

const CANAL_REGISTRO = Object.freeze({
  EXTERNO: 'EXTERNO',
  INTERNO: 'INTERNO'
});

const SOURCE = Object.freeze({
  PUBLIC: 'PUBLIC',
  INTERNAL: 'INTERNAL'
});

const normalizarTexto = (value) => String(value || '').trim();

const parseFechaValida = (value) => {
  if (!value) return null;
  const fecha = new Date(value);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

const buildPublicSolicitudOrigin = (payload = {}) => {
  const fechaSolicitud = parseFechaValida(payload.solicitud_enviada_en)
    || parseFechaValida(payload.fecha_envio_solicitud)
    || new Date();

  return {
    origen_solicitud: ORIGEN_SOLICITUD.EXTERNO,
    es_publica: true,
    es_externa: true,
    canal_registro: CANAL_REGISTRO.EXTERNO,
    source: SOURCE.PUBLIC,
    origen: ORIGEN_SOLICITUD.EXTERNO,
    solicitud_enviada_en: fechaSolicitud,
    fecha_envio_solicitud: fechaSolicitud
  };
};

const buildInternalSolicitudOrigin = (payload = {}) => {
  const fechaSolicitud = parseFechaValida(payload.solicitud_enviada_en)
    || parseFechaValida(payload.fecha_envio_solicitud)
    || null;

  return {
    origen_solicitud: ORIGEN_SOLICITUD.INTERNO,
    es_publica: false,
    es_externa: false,
    canal_registro: CANAL_REGISTRO.INTERNO,
    source: SOURCE.INTERNAL,
    origen: ORIGEN_SOLICITUD.INTERNO,
    solicitud_enviada_en: fechaSolicitud,
    fecha_envio_solicitud: fechaSolicitud
  };
};

const inferirOrigenSolicitud = (solicitud = {}) => {
  const origenSolicitud = normalizarTexto(solicitud.origen_solicitud).toUpperCase();
  const canalRegistro = normalizarTexto(solicitud.canal_registro).toUpperCase();
  const source = normalizarTexto(solicitud.source).toUpperCase();
  const legacyOrigen = normalizarTexto(solicitud.origen).toUpperCase();

  if (
    origenSolicitud === ORIGEN_SOLICITUD.EXTERNO ||
    canalRegistro === CANAL_REGISTRO.EXTERNO ||
    source === SOURCE.PUBLIC ||
    legacyOrigen === ORIGEN_SOLICITUD.EXTERNO ||
    solicitud.es_publica === true ||
    solicitud.es_externa === true
  ) {
    return {
      origen_solicitud: ORIGEN_SOLICITUD.EXTERNO,
      es_publica: solicitud.es_publica ?? true,
      es_externa: solicitud.es_externa ?? true,
      canal_registro: canalRegistro || CANAL_REGISTRO.EXTERNO,
      source: source || SOURCE.PUBLIC,
      origen: legacyOrigen || ORIGEN_SOLICITUD.EXTERNO,
      solicitud_enviada_en: solicitud.solicitud_enviada_en || solicitud.fecha_envio_solicitud || null,
      fecha_envio_solicitud: solicitud.fecha_envio_solicitud || solicitud.solicitud_enviada_en || null
    };
  }

  return {
    origen_solicitud: origenSolicitud || ORIGEN_SOLICITUD.INTERNO,
    es_publica: solicitud.es_publica ?? false,
    es_externa: solicitud.es_externa ?? false,
    canal_registro: canalRegistro || CANAL_REGISTRO.INTERNO,
    source: source || SOURCE.INTERNAL,
    origen: legacyOrigen || ORIGEN_SOLICITUD.INTERNO,
    solicitud_enviada_en: solicitud.solicitud_enviada_en || solicitud.fecha_envio_solicitud || null,
    fecha_envio_solicitud: solicitud.fecha_envio_solicitud || solicitud.solicitud_enviada_en || null
  };
};

const applyOrigenSolicitud = (solicitud = {}) => ({
  ...solicitud,
  ...inferirOrigenSolicitud(solicitud)
});

const ensureSolicitudOrigenColumns = async (sequelize) => {
  await sequelize.query(`
    ALTER TABLE public.solicitudes
      ADD COLUMN IF NOT EXISTS origen_solicitud character varying(20) DEFAULT 'INTERNO',
      ADD COLUMN IF NOT EXISTS es_publica boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS es_externa boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS canal_registro character varying(20) DEFAULT 'INTERNO',
      ADD COLUMN IF NOT EXISTS source character varying(20) DEFAULT 'INTERNAL',
      ADD COLUMN IF NOT EXISTS solicitud_enviada_en timestamp without time zone NULL,
      ADD COLUMN IF NOT EXISTS fecha_envio_solicitud timestamp without time zone NULL
  `);

  await sequelize.query(`
    UPDATE public.solicitudes
    SET
      origen_solicitud = COALESCE(UPPER(origen_solicitud), 'INTERNO'),
      es_publica = COALESCE(es_publica, false),
      es_externa = COALESCE(es_externa, false),
      canal_registro = COALESCE(UPPER(canal_registro), 'INTERNO'),
      source = COALESCE(UPPER(source), 'INTERNAL'),
      origen = COALESCE(UPPER(origen), 'INTERNO'),
      solicitud_enviada_en = COALESCE(solicitud_enviada_en, fecha_envio_solicitud, creado_en),
      fecha_envio_solicitud = COALESCE(fecha_envio_solicitud, solicitud_enviada_en, creado_en)
    WHERE
      origen_solicitud IS NULL
      OR es_publica IS NULL
      OR es_externa IS NULL
      OR canal_registro IS NULL
      OR source IS NULL
      OR solicitud_enviada_en IS NULL
      OR fecha_envio_solicitud IS NULL
  `);
};

module.exports = {
  ORIGEN_SOLICITUD,
  CANAL_REGISTRO,
  SOURCE,
  buildPublicSolicitudOrigin,
  buildInternalSolicitudOrigin,
  inferirOrigenSolicitud,
  applyOrigenSolicitud,
  ensureSolicitudOrigenColumns
};
