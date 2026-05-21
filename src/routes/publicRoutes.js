const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Op } = require('sequelize');
const {
  Cliente,
  Solicitud,
  SolicitudShortForm,
  SolicitudDocumento,
  ClienteEmailVerificacion,
  ModeloAprobacion,
  sequelize
} = require('../models');
const {
  buildPublicSolicitudOrigin,
  ensureSolicitudOrigenColumns
} = require('../utils/solicitudOrigen');
const {
  ensureSolicitudFinancialColumns
} = require('../utils/solicitudFinancialColumns');
const { normalizarModalidad, MODALIDADES_PERMITIDAS } = require('../utils/tasaModalidad');
const { sendOtpVerificationEmail } = require('../utils/emailVerificationService');
const {
  calculateFlatLoanPricing,
  resolveInterestPercentageInput
} = require('../services/financial/loanPricingService');
const {
  ensureClienteFechaNacimientoColumn,
  formatDateOnly
} = require('../utils/clienteEdad');
const {
  authenticateToken,
  requirePermission
} = require('../middleware/auth');

const router = express.Router();

const OTP_EXPIRES_SECONDS = 600;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MIN_RESEND_SECONDS = 60;
const OTP_MAX_SENDS_PER_HOUR = 5;
const EMAIL_VERIFICATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const DOCUMENT_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'solicitudes');
if (!fs.existsSync(DOCUMENT_UPLOAD_DIR)) {
  fs.mkdirSync(DOCUMENT_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DOCUMENT_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.pdf';
    const baseName = path.basename(file.originalname || 'documento', ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    cb(null, `${timestamp}-${random}-${baseName}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || path.extname(file.originalname || '').toLowerCase() === '.pdf';
    if (!isPdf) return cb(new Error('Tipo de archivo inválido'));
    return cb(null, true);
  }
});

const uploadPublicSolicitudDocumentos = (req, res, next) => {
  upload.array('documentos', 3)(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({
      success: false,
      message: 'Tipo de archivo inválido'
    });
  });
};

const normalizarTexto = (value) => String(value || '').trim();
const normalizarEmail = (email) => String(email || '').trim().toLowerCase();
const validarFormatoEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
const generarCodigoOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const normalizarTextoNullable = (value) => {
  const text = normalizarTexto(value);
  return text ? text : null;
};
const normalizarBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};
const normalizarDecimalNullable = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};
const getRequestIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
};
const mergeShortFormSources = (req) => ({
  ...(req.query || {}),
  ...(req.body || {})
});
const buildShortFormTrackingPayload = (sourceData = {}) => ({
  manual: sourceData.manual,
  entry_source: sourceData.entry_source,
  requested_amount_source: sourceData.requested_amount_source,
  source: sourceData.source,
  ad_id: sourceData.ad_id,
  campaign_id: sourceData.campaign_id,
  campaign_name: sourceData.campaign_name,
  adset_id: sourceData.adset_id,
  adset_name: sourceData.adset_name,
  origin: sourceData.origin,
  aid: sourceData.aid,
  utm_medium: sourceData.utm_medium,
  utm_source: sourceData.utm_source,
  utm_id: sourceData.utm_id,
  utm_content: sourceData.utm_content,
  utm_term: sourceData.utm_term,
  utm_campaign: sourceData.utm_campaign,
  fbclid: sourceData.fbclid,
  requested_amount: sourceData.requested_amount
});

const buildOtpHash = (email, code) =>
  crypto.createHash('sha256').update(`${normalizarEmail(email)}|${String(code)}|${process.env.OTP_SECRET || 'crediflash-otp-secret'}`).digest('hex');

const timingSafeEqual = (left, right) => {
  try {
    const a = Buffer.from(String(left || ''), 'utf8');
    const b = Buffer.from(String(right || ''), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_error) {
    return false;
  }
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const publicRateState = new Map();
const isRateLimited = ({ scope, key, limit, windowMs }) => {
  const now = Date.now();
  const mapKey = `${scope}:${key}`;
  const previous = publicRateState.get(mapKey) || [];
  const filtered = previous.filter((ts) => now - ts < windowMs);
  if (filtered.length >= limit) {
    publicRateState.set(mapKey, filtered);
    return true;
  }
  filtered.push(now);
  publicRateState.set(mapKey, filtered);
  return false;
};

const getRequesterIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
};

let tipoDocumentoColumnChecked = false;
const ensureSolicitudDocumentoTipoColumn = async () => {
  if (tipoDocumentoColumnChecked) return;
  await sequelize.query(`
    ALTER TABLE public.solicitud_documentos
    ADD COLUMN IF NOT EXISTS tipo_documento character varying(30)
  `);
  tipoDocumentoColumnChecked = true;
};

let origenColumnsChecked = false;
const ensureOrigenColumns = async () => {
  if (origenColumnsChecked) return;
  await sequelize.query(`
    ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS origen character varying(30)
  `);
  await ensureSolicitudOrigenColumns(sequelize);
  origenColumnsChecked = true;
};

const eliminarArchivos = async (archivos = []) => {
  if (!archivos || archivos.length === 0) return;
  await Promise.all(archivos.map((archivo) => fs.promises.unlink(archivo.path).catch(() => null)));
};

const normalizarModeloCalificacion = (modeloCalificacion) => {
  if (!modeloCalificacion) return null;
  const normalizado = modeloCalificacion.trim().toUpperCase();
  const permitidos = ['CLIENTE_ANTIGUO', 'CLIENTE_NUEVO', 'EDITAR'];
  return permitidos.includes(normalizado) ? normalizado : null;
};

const validarYClasificarDocumentosSolicitud = (archivos = [], reqBody = {}) => {
  const tipoDocumentoIdentidad = normalizarTexto(reqBody.tipo_documento_identidad || 'ID').toUpperCase();
  const tipoDocumentosEstadoCuenta = normalizarTexto(reqBody.tipo_documentos_estado_cuenta || 'ESTADO_CUENTA').toUpperCase();

  if (tipoDocumentoIdentidad !== 'ID') throw new Error('tipo_documento_identidad inválido. Debe ser ID.');
  if (tipoDocumentosEstadoCuenta !== 'ESTADO_CUENTA') throw new Error('tipo_documentos_estado_cuenta inválido. Debe ser ESTADO_CUENTA.');
  if (!Array.isArray(archivos) || archivos.length === 0) return [];
  if (archivos.length > 3) throw new Error('Solo se permiten hasta 3 documentos PDF');

  const noPdf = archivos.find((file) => file.mimetype !== 'application/pdf');
  if (noPdf) throw new Error('Tipo de archivo inválido');

  const clasificarArchivo = (archivo, index) => {
    const nombre = normalizarTexto(archivo?.originalname || archivo?.filename || '').toLowerCase();
    const esIdentidad = /ident|id|documento[_-]?identidad/.test(nombre);
    const esEstadoCuenta = /statement|estado[_-]?cuenta|account[_-]?statement/.test(nombre);

    if (esIdentidad && !esEstadoCuenta) return 'ID';
    if (esEstadoCuenta && !esIdentidad) return 'ESTADO_CUENTA';

    return index === 0 ? 'ID' : 'ESTADO_CUENTA';
  };

  return archivos.map((archivo, index) => ({
    archivo,
    tipo_documento: clasificarArchivo(archivo, index)
  }));
};

const resolverModeloAprobacion = async (modeloAprobacionInput) => {
  const valor = normalizarTexto(modeloAprobacionInput);
  if (!valor) throw new Error('modelo_aprobacion es requerido.');

  if (UUID_REGEX.test(valor)) {
    const modeloPorId = await ModeloAprobacion.findByPk(valor);
    if (!modeloPorId) throw new Error('modelo_aprobacion inválido. No existe el modelo indicado.');
    return modeloPorId;
  }

  const [modelo] = await ModeloAprobacion.findOrCreate({
    where: { nombre: valor },
    defaults: {
      reglas: {},
      puntaje_minimo: 0,
      activo: true,
      creado_en: new Date()
    }
  });

  return modelo;
};

const validarCorreoVerificado = async (email) => {
  if (!email) return true;
  const emailNormalizado = normalizarEmail(email);
  if (!validarFormatoEmail(emailNormalizado)) {
    throw new Error('Email inválido');
  }

  const verificacion = await ClienteEmailVerificacion.findOne({ where: { email: emailNormalizado } });
  const isVerified = Boolean(verificacion?.verified);
  const verifiedAtMs = verificacion?.verified_at ? new Date(verificacion.verified_at).getTime() : 0;

  if (!isVerified || !verifiedAtMs || (Date.now() - verifiedAtMs) > EMAIL_VERIFICATION_WINDOW_MS) {
    throw new Error('El correo no ha sido verificado');
  }

  return true;
};

// GET /api/public/clientes/referibles
router.get('/clientes/referibles', async (req, res) => {
  try {
    const clientes = await Cliente.findAll({
      where: { estado: 'ACTIVO' },
      attributes: ['id', 'nombre', 'apellido'],
      order: [['nombre', 'ASC'], ['apellido', 'ASC']],
      limit: 500
    });

    return res.json({
      success: true,
      data: clientes
    });
  } catch (error) {
    console.error('Error listando referibles públicos:', error);
    return res.status(500).json({
      success: false,
      message: 'Error obteniendo clientes referibles'
    });
  }
});

// POST /api/public/clientes/verificacion-email/enviar
router.post('/clientes/verificacion-email/enviar', async (req, res) => {
  try {
    const email = normalizarEmail(req.body?.email);
    const ip = getRequesterIp(req);

    if (!email || !validarFormatoEmail(email)) {
      return res.status(400).json({ success: false, message: 'Email inválido' });
    }

    if (isRateLimited({ scope: 'public-otp-ip', key: ip, limit: 30, windowMs: 60 * 60 * 1000 })) {
      return res.status(429).json({ success: false, message: 'Rate limit excedido. Intenta nuevamente más tarde' });
    }

    if (isRateLimited({ scope: 'public-otp-email', key: email, limit: OTP_MAX_SENDS_PER_HOUR, windowMs: 60 * 60 * 1000 })) {
      return res.status(429).json({ success: false, message: 'Rate limit excedido. Intenta nuevamente más tarde' });
    }

    const ahora = new Date();
    const verificacion = await ClienteEmailVerificacion.findOne({ where: { email } });
    if (verificacion?.last_sent_at) {
      const secondsFromLastSend = Math.floor((ahora.getTime() - new Date(verificacion.last_sent_at).getTime()) / 1000);
      if (secondsFromLastSend < OTP_MIN_RESEND_SECONDS) {
        return res.status(429).json({
          success: false,
          message: `Rate limit excedido. Reintenta en ${OTP_MIN_RESEND_SECONDS - secondsFromLastSend} segundos`
        });
      }
    }

    const codigo = generarCodigoOtp();
    const codigoHash = buildOtpHash(email, codigo);
    const expiresAt = new Date(ahora.getTime() + OTP_EXPIRES_SECONDS * 1000);

    if (!verificacion) {
      await ClienteEmailVerificacion.create({
        email,
        codigo_hash: codigoHash,
        expires_at: expiresAt,
        intentos: 0,
        max_intentos: OTP_MAX_ATTEMPTS,
        verified: false,
        verified_at: null,
        send_count: 1,
        last_sent_at: ahora,
        created_at: ahora,
        updated_at: ahora
      });
    } else {
      await verificacion.update({
        codigo_hash: codigoHash,
        expires_at: expiresAt,
        intentos: 0,
        max_intentos: OTP_MAX_ATTEMPTS,
        verified: false,
        verified_at: null,
        send_count: (verificacion.send_count || 0) + 1,
        last_sent_at: ahora,
        updated_at: ahora
      });
    }

    await sendOtpVerificationEmail({
      to: email,
      codigo,
      expiresInMinutes: Math.floor(OTP_EXPIRES_SECONDS / 60)
    });

    return res.json({
      success: true,
      message: 'Código de verificación enviado.',
      data: {
        email,
        expires_in_seconds: OTP_EXPIRES_SECONDS
      }
    });
  } catch (error) {
    console.error('Error enviando OTP público:', error);
    return res.status(500).json({
      success: false,
      message: 'Error enviando código de verificación'
    });
  }
});

// POST /api/public/clientes/verificacion-email/verificar
router.post('/clientes/verificacion-email/verificar', async (req, res) => {
  try {
    const email = normalizarEmail(req.body?.email);
    const codigo = String(req.body?.codigo || '').trim();

    if (!email || !validarFormatoEmail(email)) {
      return res.status(400).json({ success: false, message: 'Email inválido' });
    }
    if (!codigo || !/^\d{6}$/.test(codigo)) {
      return res.status(400).json({ success: false, message: 'Código inválido' });
    }

    const verificacion = await ClienteEmailVerificacion.findOne({ where: { email } });
    if (!verificacion || !verificacion.codigo_hash) {
      return res.status(400).json({ success: false, message: 'Código inválido' });
    }
    if ((verificacion.intentos || 0) >= (verificacion.max_intentos || OTP_MAX_ATTEMPTS)) {
      return res.status(429).json({ success: false, message: 'Demasiados intentos' });
    }
    if (!verificacion.expires_at || new Date(verificacion.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Código expirado' });
    }

    const expectedHash = buildOtpHash(email, codigo);
    if (!timingSafeEqual(expectedHash, verificacion.codigo_hash)) {
      await verificacion.update({
        intentos: (verificacion.intentos || 0) + 1,
        updated_at: new Date()
      });
      return res.status(400).json({ success: false, message: 'Código inválido' });
    }

    const verifiedAt = new Date();
    await verificacion.update({
      verified: true,
      verified_at: verifiedAt,
      codigo_hash: null,
      expires_at: null,
      intentos: 0,
      updated_at: verifiedAt
    });

    return res.json({
      success: true,
      message: 'Correo verificado correctamente.',
      data: {
        email,
        verified: true,
        verified_at: verifiedAt.toISOString()
      }
    });
  } catch (error) {
    console.error('Error verificando OTP público:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verificando correo'
    });
  }
});

// POST /api/public/clientes
router.post('/clientes', async (req, res) => {
  try {
    const ip = getRequesterIp(req);
    if (isRateLimited({ scope: 'public-client-create', key: ip, limit: 30, windowMs: 60 * 60 * 1000 })) {
      return res.status(429).json({ success: false, message: 'Rate limit excedido. Intenta nuevamente más tarde' });
    }

    await ensureOrigenColumns();

    const {
      nombre,
      apellido,
      telefono,
      email,
      direccion,
      nombre_contacto,
      apellido_contacto,
      telefono_contacto,
      email_contacto,
      direccion_contacto,
      es_referido,
      referido_por,
      monto_referido,
      estado,
      observaciones
    } = req.body || {};

    if (!nombre || !apellido) {
      return res.status(400).json({ success: false, message: 'Nombre y apellido son requeridos' });
    }

    const emailNormalizado = email ? normalizarEmail(email) : null;
    if (emailNormalizado) {
      await validarCorreoVerificado(emailNormalizado);
    }

    const referidoFlag = es_referido === true || es_referido === 'true' || es_referido === 1 || es_referido === '1';
    const referidoPorValue = referidoFlag ? (String(referido_por || '').trim() || null) : null;
    const montoReferidoNumero = monto_referido !== undefined && monto_referido !== null && `${monto_referido}` !== ''
      ? parseFloat(monto_referido)
      : 0;

    if (Number.isNaN(montoReferidoNumero) || montoReferidoNumero < 0) {
      return res.status(400).json({
        success: false,
        message: 'monto_referido debe ser un número mayor o igual a 0'
      });
    }

    await ensureClienteFechaNacimientoColumn(sequelize);

    const cliente = await sequelize.transaction(async (transaction) => {
      const nuevoCliente = await Cliente.create({
        nombre: normalizarTexto(nombre),
        apellido: normalizarTexto(apellido),
        telefono: normalizarTexto(telefono) || null,
        email: emailNormalizado || null,
        direccion: normalizarTexto(direccion) || null,
        nombre_contacto: normalizarTexto(nombre_contacto) || null,
        apellido_contacto: normalizarTexto(apellido_contacto) || null,
        telefono_contacto: normalizarTexto(telefono_contacto) || null,
        email_contacto: normalizarTexto(email_contacto) || null,
        direccion_contacto: normalizarTexto(direccion_contacto) || null,
        es_referido: referidoFlag,
        referido_por: referidoPorValue,
        monto_referido: montoReferidoNumero,
        estado: estado || 'ACTIVO',
        observaciones: normalizarTexto(observaciones) || null,
        fecha_nacimiento: formatDateOnly(req.body?.fecha_nacimiento),
        fecha_registro: new Date()
      }, { transaction });

      await sequelize.query(
        'UPDATE public.clientes SET origen = :origen WHERE id = :id',
        { replacements: { origen: 'PUBLIC_FORM', id: nuevoCliente.id }, transaction }
      );

      return nuevoCliente;
    });

    return res.status(201).json({
      success: true,
      data: {
        id: cliente.id
      }
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Error creando cliente público'
    });
  }
});

// POST /api/public/solicitudes
router.post('/solicitudes', uploadPublicSolicitudDocumentos, async (req, res) => {
  try {
    const ip = getRequesterIp(req);
    if (isRateLimited({ scope: 'public-solicitud-create', key: ip, limit: 20, windowMs: 60 * 60 * 1000 })) {
      await eliminarArchivos(req.files || []);
      return res.status(429).json({ success: false, message: 'Rate limit excedido. Intenta nuevamente más tarde' });
    }

    await ensureOrigenColumns();
    await ensureSolicitudDocumentoTipoColumn();
    await ensureSolicitudFinancialColumns(sequelize);
    await ensureClienteFechaNacimientoColumn(sequelize);

    const {
      cliente_id,
      monto_solicitado,
      plazo_semanas,
      interes_porcentaje,
      tasa_variable,
      tasa_base,
      modalidad,
      modelo_aprobacion,
      modelo_aprobacion_id,
      modelo_calificacion,
      destino
    } = req.body || {};

    const errores = [];
    if (!cliente_id) errores.push('cliente_id es requerido');
    if (!monto_solicitado && monto_solicitado !== 0) errores.push('monto_solicitado es requerido');
    if (!plazo_semanas && plazo_semanas !== 0) errores.push('plazo_semanas es requerido');
    if (!modalidad) errores.push('modalidad es requerida');
    if (interes_porcentaje === undefined && tasa_variable === undefined && tasa_base === undefined) errores.push('interes_porcentaje es requerido');
    if (!modelo_calificacion || `${modelo_calificacion}`.trim() === '') errores.push('modelo_calificacion es requerido.');
    if (!modelo_aprobacion && !modelo_aprobacion_id) errores.push('modelo_aprobacion es requerido.');
    if (!destino || `${destino}`.trim() === '') errores.push('destino es requerido');

    if (errores.length > 0) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({
        success: false,
        message: 'Errores de validación',
        errors: errores
      });
    }

    const monto = parseFloat(monto_solicitado);
    const plazo = parseInt(plazo_semanas, 10);
    if (Number.isNaN(monto) || monto <= 0) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({ success: false, message: 'El monto solicitado debe ser un número mayor a 0' });
    }
    if (Number.isNaN(plazo) || plazo <= 0 || plazo > 520) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({ success: false, message: 'El plazo en semanas debe ser un número entre 1 y 520' });
    }
    const modalidadNormalizada = normalizarModalidad(modalidad);
    if (!MODALIDADES_PERMITIDAS.includes(modalidadNormalizada)) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({
        success: false,
        message: 'modalidad inválida. Valores permitidos: SEMANAL, QUINCENAL, MENSUAL.'
      });
    }

    let interesPorcentajeVisible;
    try {
      interesPorcentajeVisible = resolveInterestPercentageInput({
        interesPorcentaje: interes_porcentaje,
        tasaVariable: tasa_variable,
        tasaBase: tasa_base
      });
    } catch (error) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({ success: false, message: error.message || 'No se pudo interpretar el porcentaje de interés' });
    }

    const cliente = await Cliente.findByPk(cliente_id);
    if (!cliente) {
      await eliminarArchivos(req.files || []);
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }
    if (cliente.estado !== 'ACTIVO') {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({ success: false, message: `El cliente está ${cliente.estado.toLowerCase()}. No puede solicitar préstamos.` });
    }

    const archivos = Array.isArray(req.files) ? req.files : [];
    let documentosClasificados = [];
    try {
      documentosClasificados = validarYClasificarDocumentosSolicitud(archivos, req.body || {});
    } catch (error) {
      await eliminarArchivos(archivos);
      return res.status(400).json({ success: false, message: error.message || 'Documentación inválida' });
    }

    let modeloAprobacionSeleccionado = null;
    try {
      modeloAprobacionSeleccionado = await resolverModeloAprobacion(modelo_aprobacion || modelo_aprobacion_id);
    } catch (error) {
      await eliminarArchivos(archivos);
      return res.status(400).json({ success: false, message: error.message || 'modelo_aprobacion inválido' });
    }

    const modeloCalificacionNormalizado = normalizarModeloCalificacion(modelo_calificacion);
    if (!modeloCalificacionNormalizado) {
      await eliminarArchivos(archivos);
      return res.status(400).json({
        success: false,
        message: 'modelo_calificacion inválido. Use CLIENTE_ANTIGUO, CLIENTE_NUEVO o EDITAR'
      });
    }

    const solicitud = await sequelize.transaction(async (transaction) => {
      const financialPreview = calculateFlatLoanPricing({
        montoOriginal: monto,
        interesPorcentaje: interesPorcentajeVisible,
        modalidad: modalidadNormalizada,
        numeroCuotas: plazo,
        fechaInicio: new Date()
      });

      const nuevaSolicitud = await Solicitud.create({
        cliente_id,
        analista_id: null,
        monto_solicitado: monto,
        plazo_semanas: plazo,
        modalidad: modalidadNormalizada,
        interes_porcentaje: interesPorcentajeVisible,
        tasa_base: Number((interesPorcentajeVisible / 100).toFixed(4)),
        tasa_variable: Number((interesPorcentajeVisible / 100).toFixed(4)),
        interes_total: financialPreview.interes_total,
        numero_cuotas: financialPreview.numero_cuotas,
        valor_cuota: financialPreview.valor_cuota,
        fecha_fin: financialPreview.fecha_fin,
        modelo_aprobacion_id: modeloAprobacionSeleccionado.id,
        modelo_calificacion: modeloCalificacionNormalizado,
        ...buildPublicSolicitudOrigin(req.body || {}),
        estado: 'PENDIENTE',
        creado_en: new Date(),
        destino: normalizarTexto(destino)
      }, { transaction });

      const documentosData = documentosClasificados.map(({ archivo, tipo_documento }) => ({
        solicitud_id: nuevaSolicitud.id,
        nombre_original: archivo.originalname,
        nombre_archivo: archivo.filename,
        mime_type: archivo.mimetype,
        size_bytes: archivo.size,
        tipo_documento,
        ruta: path.relative(path.join(__dirname, '..', '..'), archivo.path)
      }));
      await SolicitudDocumento.bulkCreate(documentosData, { transaction });

      return nuevaSolicitud;
    });

    return res.status(201).json({
      success: true,
      data: {
        id: solicitud.id,
        origen_solicitud: solicitud.origen_solicitud,
        es_publica: solicitud.es_publica,
        es_externa: solicitud.es_externa,
        canal_registro: solicitud.canal_registro,
        source: solicitud.source,
        interes_porcentaje: resolveInterestPercentageInput({
          interesPorcentaje: solicitud.interes_porcentaje ?? solicitud.tasa_variable ?? solicitud.tasa_base
        }),
        tasa_base: resolveInterestPercentageInput({
          interesPorcentaje: solicitud.tasa_base ?? solicitud.tasa_variable ?? solicitud.interes_porcentaje
        }),
        tasa_variable: resolveInterestPercentageInput({
          interesPorcentaje: solicitud.tasa_variable ?? solicitud.tasa_base ?? solicitud.interes_porcentaje
        }),
        interes_total: solicitud.interes_total,
        numero_cuotas: solicitud.numero_cuotas,
        valor_cuota: solicitud.valor_cuota,
        fecha_fin: solicitud.fecha_fin
      }
    });
  } catch (error) {
    console.error('Error creando solicitud pública:', error);
    await eliminarArchivos(req.files || []);
    return res.status(500).json({
      success: false,
      message: 'Error creando solicitud pública'
    });
  }
});

// POST /api/public/solicitudes-short-form
router.post('/solicitudes-short-form', async (req, res) => {
  try {
    const ip = getRequestIp(req);
    if (isRateLimited({ scope: 'public-short-form-create', key: ip, limit: 40, windowMs: 60 * 60 * 1000 })) {
      return res.status(429).json({ success: false, message: 'Rate limit excedido. Intenta nuevamente más tarde' });
    }

    const sourceData = mergeShortFormSources(req);
    const nombre = normalizarTexto(sourceData.nombre);
    const apellido = normalizarTexto(sourceData.apellido);
    const telefono = normalizarTexto(sourceData.telefono);
    const email = normalizarEmail(sourceData.email);
    const montoSolicitado = normalizarDecimalNullable(sourceData.monto_solicitado ?? sourceData.requested_amount);
    const modalidad = normalizarModalidad(sourceData.modalidad || 'SEMANAL');
    const idioma = normalizarTexto(sourceData.idioma || 'es') || 'es';
    const origen = normalizarTexto(sourceData.origen || sourceData.origin || 'SHORT_FORM') || 'SHORT_FORM';
    const estado = normalizarTexto(sourceData.estado || 'PENDIENTE').toUpperCase() || 'PENDIENTE';

    const errores = [];
    if (!nombre) errores.push('nombre es requerido');
    if (!apellido) errores.push('apellido es requerido');
    if (!telefono) errores.push('telefono es requerido');
    if (!email || !validarFormatoEmail(email)) errores.push('email válido es requerido');
    if (montoSolicitado === null || montoSolicitado <= 0) errores.push('monto_solicitado es requerido y debe ser mayor a 0');
    if (!MODALIDADES_PERMITIDAS.includes(modalidad)) errores.push('modalidad inválida. Use SEMANAL, QUINCENAL o MENSUAL');

    if (errores.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Errores de validación',
        errors: errores
      });
    }

    const registro = await SolicitudShortForm.create({
      nombre,
      apellido,
      telefono,
      email,
      monto_solicitado: montoSolicitado,
      requested_amount: normalizarDecimalNullable(sourceData.requested_amount) ?? montoSolicitado,
      modalidad,
      idioma,
      origen,
      origin: normalizarTextoNullable(sourceData.origin),
      source: normalizarTextoNullable(sourceData.source),
      estado,
      manual: normalizarBoolean(sourceData.manual, false),
      entry_source: normalizarTextoNullable(sourceData.entry_source),
      requested_amount_source: normalizarTextoNullable(sourceData.requested_amount_source),
      ad_id: normalizarTextoNullable(sourceData.ad_id),
      campaign_id: normalizarTextoNullable(sourceData.campaign_id),
      campaign_name: normalizarTextoNullable(sourceData.campaign_name),
      adset_id: normalizarTextoNullable(sourceData.adset_id),
      adset_name: normalizarTextoNullable(sourceData.adset_name),
      aid: normalizarTextoNullable(sourceData.aid),
      utm_medium: normalizarTextoNullable(sourceData.utm_medium),
      utm_source: normalizarTextoNullable(sourceData.utm_source),
      utm_id: normalizarTextoNullable(sourceData.utm_id),
      utm_content: normalizarTextoNullable(sourceData.utm_content),
      utm_term: normalizarTextoNullable(sourceData.utm_term),
      utm_campaign: normalizarTextoNullable(sourceData.utm_campaign),
      fbclid: normalizarTextoNullable(sourceData.fbclid),
      ip_address: ip,
      user_agent: normalizarTextoNullable(req.headers['user-agent']),
      tracking_payload: buildShortFormTrackingPayload(sourceData),
      created_at: new Date(),
      updated_at: new Date()
    });

    return res.status(201).json({
      success: true,
      message: 'Solicitud short form creada correctamente',
      data: {
        id: registro.id,
        estado: registro.estado,
        created_at: registro.created_at
      }
    });
  } catch (error) {
    console.error('Error creando solicitud short form:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error creando solicitud short form'
    });
  }
});

// GET /api/public/solicitudes-short-form
router.get('/solicitudes-short-form', authenticateToken, requirePermission('solicitudes.view'), async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const offset = (page - 1) * limit;
    const { estado, origen, origin, search } = req.query || {};

    const where = {};

    if (estado && String(estado).trim()) {
      where.estado = String(estado).trim().toUpperCase();
    }

    if (origen && String(origen).trim()) {
      where.origen = String(origen).trim();
    }

    if (origin && String(origin).trim()) {
      where.origin = String(origin).trim();
    }

    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      where[Op.or] = [
        { nombre: { [Op.iLike]: term } },
        { apellido: { [Op.iLike]: term } },
        { telefono: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
        { source: { [Op.iLike]: term } },
        { origin: { [Op.iLike]: term } },
        { campaign_name: { [Op.iLike]: term } },
        { adset_name: { [Op.iLike]: term } }
      ];
    }

    const { count, rows } = await SolicitudShortForm.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    return res.json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page,
        limit,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listando solicitudes short form:', error);
    return res.status(500).json({
      success: false,
      message: 'Error obteniendo solicitudes short form'
    });
  }
});

module.exports = router;
