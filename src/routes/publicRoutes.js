const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Op } = require('sequelize');
const {
  Cliente,
  Solicitud,
  SolicitudDocumento,
  ClienteEmailVerificacion,
  ModeloAprobacion,
  sequelize
} = require('../models');
const {
  buildPublicSolicitudOrigin,
  ensureSolicitudOrigenColumns
} = require('../utils/solicitudOrigen');
const { calcularTasaEfectivaPorModalidad, normalizarModalidad, MODALIDADES_PERMITIDAS } = require('../utils/tasaModalidad');
const { sendOtpVerificationEmail } = require('../utils/emailVerificationService');

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
  if (archivos.length === 0) throw new Error('Debe cargar un documento de identidad en PDF');
  if (archivos.length < 2) throw new Error('Debe cargar al menos 1 estado de cuenta en PDF');
  if (archivos.length > 3) throw new Error('Solo se permiten 1 o 2 estados de cuenta en PDF');

  const noPdf = archivos.find((file) => file.mimetype !== 'application/pdf');
  if (noPdf) throw new Error('Tipo de archivo inválido');

  const [archivoIdentidad, ...archivosEstadoCuenta] = archivos;
  if (!archivoIdentidad) throw new Error('Debe cargar un documento de identidad en PDF');
  if (archivosEstadoCuenta.length < 1) throw new Error('Debe cargar al menos 1 estado de cuenta en PDF');
  if (archivosEstadoCuenta.length > 2) throw new Error('Solo se permiten 1 o 2 estados de cuenta en PDF');

  return [
    { archivo: archivoIdentidad, tipo_documento: 'ID' },
    ...archivosEstadoCuenta.map((archivo) => ({ archivo, tipo_documento: 'ESTADO_CUENTA' }))
  ];
};

const resolverTasas = ({ modalidad, plazoSemanas, tasaVariable, tasaBase }) => {
  const tasaBaseInput = tasaBase !== undefined && tasaBase !== null && `${tasaBase}` !== '' ? tasaBase : tasaVariable;
  return calcularTasaEfectivaPorModalidad({
    modalidad,
    tasaBase: tasaBaseInput,
    plazoSemanas
  });
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

    const {
      cliente_id,
      monto_solicitado,
      plazo_semanas,
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
    if (!tasa_variable && tasa_variable !== 0) errores.push('tasa_variable es requerido');
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
    const tasaVariableNum = parseFloat(tasa_variable);

    if (Number.isNaN(monto) || monto <= 0) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({ success: false, message: 'El monto solicitado debe ser un número mayor a 0' });
    }
    if (Number.isNaN(plazo) || plazo <= 0 || plazo > 520) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({ success: false, message: 'El plazo en semanas debe ser un número entre 1 y 520' });
    }
    if (Number.isNaN(tasaVariableNum) || tasaVariableNum <= 0) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({ success: false, message: 'tasa_variable debe ser mayor a 0' });
    }

    const modalidadNormalizada = normalizarModalidad(modalidad);
    if (!MODALIDADES_PERMITIDAS.includes(modalidadNormalizada)) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({
        success: false,
        message: 'modalidad inválida. Valores permitidos: SEMANAL, QUINCENAL, MENSUAL.'
      });
    }

    let tasasModalidad;
    try {
      tasasModalidad = resolverTasas({
        modalidad: modalidadNormalizada,
        plazoSemanas: plazo,
        tasaVariable: tasa_variable,
        tasaBase: tasa_base
      });
    } catch (error) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({ success: false, message: error.message || 'No se pudo calcular la tasa efectiva' });
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
      const nuevaSolicitud = await Solicitud.create({
        cliente_id,
        analista_id: null,
        monto_solicitado: monto,
        plazo_semanas: plazo,
        modalidad: tasasModalidad.modalidad,
        tasa_base: tasasModalidad.tasa_base,
        tasa_variable: tasasModalidad.tasa_variable,
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
        source: solicitud.source
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

module.exports = router;
