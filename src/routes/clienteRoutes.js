const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Cliente, Prestamo, Solicitud, SolicitudDocumento, ClienteEmailVerificacion, Cuota, sequelize } = require('../models');
const { Op } = require('sequelize');
const { sendCsv } = require('../utils/exporter');
const {
  getDocumentStorageState,
  normalizeUploadPath,
  resolveAbsoluteUploadPath,
  deduplicateDocuments
} = require('../utils/documentStorage');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { sendOtpVerificationEmail, verifySmtpConfig } = require('../utils/emailVerificationService');

const OTP_EXPIRES_SECONDS = 600;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MIN_RESEND_SECONDS = 60;
const OTP_MAX_SENDS_PER_HOUR = 5;
const CLIENTE_DOCUMENT_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'clientes');

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

const validateDebugSmtpToken = (req) => {
  const expected = String(process.env.SMTP_DEBUG_TOKEN || '').trim();
  if (!expected) return false;
  const received = String(
    req.headers['x-debug-token'] ||
    req.query?.token ||
    req.body?.token ||
    ''
  ).trim();
  return received && received === expected;
};

const toMoneyNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(numeric.toFixed(2));
};

const resolveSaldoPendiente = (prestamo = {}) => {
  const pendiente = toMoneyNumber(prestamo.pendiente);
  if (pendiente !== null) return Math.max(pendiente, 0);

  const totalPagar = toMoneyNumber(prestamo.total_pagar) || 0;
  const pagado = toMoneyNumber(prestamo.pagado) || 0;
  const byTotals = Number((totalPagar - pagado).toFixed(2));
  if (byTotals > 0) return byTotals;

  return 0;
};

const construirUrlDocumento = (req, rutaRelativa = '') => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const rutaNormalizada = normalizeUploadPath(rutaRelativa);
  return `${baseUrl}/${rutaNormalizada}`;
};

const asegurarDirectorio = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

asegurarDirectorio(CLIENTE_DOCUMENT_UPLOAD_DIR);

const clienteDocumentoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, CLIENTE_DOCUMENT_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.pdf';
    const baseName = path
      .basename(file.originalname || 'documento_identidad', ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50);
    cb(null, `${timestamp}-${random}-${baseName}${ext}`);
  }
});

const clienteDocumentoFilter = (_req, file, cb) => {
  const isPdf = file.mimetype === 'application/pdf' || path.extname(file.originalname || '').toLowerCase() === '.pdf';
  if (!isPdf) {
    return cb(new Error('El documento de identidad debe ser un PDF válido.'), false);
  }
  return cb(null, true);
};

const clienteDocumentoUpload = multer({
  storage: clienteDocumentoStorage,
  fileFilter: clienteDocumentoFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

const uploadDocumentoIdentidadOpcional = (req, res, next) => {
  clienteDocumentoUpload.single('documento_identidad')(req, res, (err) => {
    if (err) {
      const isPdfError = String(err.message || '').toLowerCase().includes('pdf');
      const isSizeError = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        success: false,
        message: isSizeError
          ? 'El documento de identidad supera el tamaño máximo permitido (10MB).'
          : isPdfError
            ? 'El documento de identidad debe ser un PDF válido.'
            : 'Error al cargar documento de identidad.'
      });
    }
    return next();
  });
};

const getClienteDocumentoPath = (file) => {
  if (!file?.filename) return null;
  return `uploads/clientes/${file.filename}`.replace(/\\/g, '/');
};

const buildClienteDocumentoIdentity = (req, cliente = {}, identityDoc = null) => {
  const relativePath = cliente?.documento_identidad_path || null;
  const ruta = identityDoc?.ruta || relativePath;
  const availability = getDocumentStorageState(ruta);
  const protectedUrl = `${req.protocol}://${req.get('host')}/api/clientes/${cliente.id}/documento-identidad/download`;

  if (!ruta) {
    return {
      documento_identidad: null,
      documento_identidad_url: null,
      documento_identidad_id: null,
      documento_identidad_nombre: null,
      documento_identidad_size_bytes: null
    };
  }

  const nombre = identityDoc?.nombre || path.basename(ruta);
  let sizeBytes = null;
  try {
    if (identityDoc?.size_bytes !== undefined && identityDoc?.size_bytes !== null) {
      sizeBytes = Number(identityDoc.size_bytes || 0);
    } else if (availability.exists) {
      const absolutePath = resolveAbsoluteUploadPath(ruta);
      const stats = fs.statSync(absolutePath);
      sizeBytes = Number(stats.size || 0);
    }
  } catch (_error) {
    sizeBytes = null;
  }

  return {
    documento_identidad: availability.exists ? protectedUrl : null,
    documento_identidad_url: availability.exists ? protectedUrl : null,
    documento_identidad_id: identityDoc?.id || null,
    documento_identidad_nombre: nombre || null,
    documento_identidad_size_bytes: sizeBytes,
    documento_identidad_exists: availability.exists,
    documento_identidad_storage_path: availability.relativePath
  };
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ESTADOS_CLIENTE_PERMITIDOS = ['ACTIVO', 'SUSPENDIDO', 'INACTIVO', 'BLOQUEADO'];

const buscarClienteReferidor = async (referidoPor, transaction) => {
  const valor = String(referidoPor || '').trim();
  if (!valor) return null;

  if (UUID_REGEX.test(valor)) {
    return Cliente.findOne({
      where: { id: valor, estado: 'ACTIVO' },
      transaction
    });
  }

  return Cliente.findOne({
    where: {
      estado: 'ACTIVO',
      [Op.or]: [
        { email: valor.toLowerCase() },
        { telefono: valor },
        { nombre: { [Op.iLike]: valor } },
        { apellido: { [Op.iLike]: valor } }
      ]
    },
    transaction
  });
};

const isAdminUser = (user = {}) => String(user?.rol || '').toUpperCase() === 'ADMINISTRADOR';

const getClienteHardDeleteDependencyCounts = async (clienteId, transaction = null) => {
  const solicitudes = await sequelize.query(
    `
      SELECT COUNT(*)::int AS total
      FROM public.solicitudes
      WHERE cliente_id = :clienteId
    `,
    {
      replacements: { clienteId },
      type: sequelize.QueryTypes.SELECT,
      transaction
    }
  );
  const prestamos = await sequelize.query(
    `
      SELECT COUNT(*)::int AS total
      FROM public.prestamos p
      INNER JOIN public.solicitudes s ON s.id = p.solicitud_id
      WHERE s.cliente_id = :clienteId
    `,
    {
      replacements: { clienteId },
      type: sequelize.QueryTypes.SELECT,
      transaction
    }
  );
  const cuotas = await sequelize.query(
    `
      SELECT COUNT(*)::int AS total
      FROM public.cuotas c
      INNER JOIN public.prestamos p ON p.id = c.prestamo_id
      INNER JOIN public.solicitudes s ON s.id = p.solicitud_id
      WHERE s.cliente_id = :clienteId
    `,
    {
      replacements: { clienteId },
      type: sequelize.QueryTypes.SELECT,
      transaction
    }
  );
  const documentosSolicitudes = await sequelize.query(
    `
      SELECT COUNT(*)::int AS total
      FROM public.solicitud_documentos sd
      INNER JOIN public.solicitudes s ON s.id = sd.solicitud_id
      WHERE s.cliente_id = :clienteId
    `,
    {
      replacements: { clienteId },
      type: sequelize.QueryTypes.SELECT,
      transaction
    }
  );
  const documentosCliente = await sequelize.query(
    `
      SELECT COUNT(*)::int AS total
      FROM public.cliente_documentos
      WHERE cliente_id = :clienteId
    `,
    {
      replacements: { clienteId },
      type: sequelize.QueryTypes.SELECT,
      transaction
    }
  );

  return {
    solicitudes: Number(solicitudes?.[0]?.total || 0),
    prestamos: Number(prestamos?.[0]?.total || 0),
    cuotas: Number(cuotas?.[0]?.total || 0),
    documentos_solicitudes: Number(documentosSolicitudes?.[0]?.total || 0),
    documentos_cliente: Number(documentosCliente?.[0]?.total || 0)
  };
};

const deletePhysicalClienteFiles = async (cliente = {}) => {
  const paths = new Set();

  if (cliente?.documento_identidad_path) {
    const availability = getDocumentStorageState(cliente.documento_identidad_path);
    if (availability.valid && availability.absolutePath && availability.exists) {
      paths.add(availability.absolutePath);
    }
  }

  const documentosCliente = await sequelize.query(
    `
      SELECT ruta
      FROM public.cliente_documentos
      WHERE cliente_id = :clienteId
    `,
    {
      replacements: { clienteId: cliente.id },
      type: sequelize.QueryTypes.SELECT
    }
  );

  (documentosCliente || []).forEach((doc) => {
    const availability = getDocumentStorageState(doc?.ruta);
    if (availability.valid && availability.absolutePath && availability.exists) {
      paths.add(availability.absolutePath);
    }
  });

  await Promise.all(Array.from(paths).map((filePath) => fs.promises.unlink(filePath).catch(() => null)));
};

const performClienteHardDelete = async (req, res, clienteId) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'Solo un administrador puede ejecutar la eliminación física de clientes.',
      code: 'FORBIDDEN'
    });
  }

  await ensureClienteDocumentoColumn();
  await ensureClienteDocumentosTable();

  const cliente = await Cliente.findByPk(clienteId);
  if (!cliente) {
    return res.status(404).json({
      success: false,
      message: 'Cliente no encontrado'
    });
  }

  const dependencyCounts = await getClienteHardDeleteDependencyCounts(cliente.id);
  const hasSensitiveDependencies = Object.entries(dependencyCounts).some(([, value]) => Number(value || 0) > 0);

  if (hasSensitiveDependencies) {
    return res.status(409).json({
      success: false,
      message: 'No se puede eliminar físicamente el cliente porque tiene relaciones sensibles asociadas.',
      policy: 'BLOCK_IF_DEPENDENCIES_EXIST',
      dependencies: dependencyCounts
    });
  }

  await deletePhysicalClienteFiles(cliente);

  await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      'DELETE FROM public.cliente_documentos WHERE cliente_id = :clienteId',
      {
        replacements: { clienteId: cliente.id },
        type: sequelize.QueryTypes.DELETE,
        transaction
      }
    );

    await cliente.destroy({ transaction });
  });

  return res.json({
    success: true,
    action: 'ELIMINACION_FISICA',
    message: 'Cliente eliminado físicamente de la base de datos'
  });
};

let clienteReferidosColumnsChecked = false;
const ensureClienteReferidosColumns = async () => {
  if (clienteReferidosColumnsChecked) return;
  await sequelize.query(`
    ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS descuentos_referido_disponibles integer NOT NULL DEFAULT 0
  `);
  await sequelize.query(`
    ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS descuentos_referido_aplicados integer NOT NULL DEFAULT 0
  `);
  clienteReferidosColumnsChecked = true;
};

let clienteEstadoColumnsChecked = false;
const ensureClienteEstadoColumns = async () => {
  if (clienteEstadoColumnsChecked) return;

  await sequelize.query(`
    ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS motivo_estado text NULL
  `);

  await sequelize.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_type t
        WHERE t.typname = 'enum_clientes_estado'
      ) THEN
        BEGIN
          ALTER TYPE enum_clientes_estado ADD VALUE IF NOT EXISTS 'SUSPENDIDO';
          ALTER TYPE enum_clientes_estado ADD VALUE IF NOT EXISTS 'BLOQUEADO';
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END;
      END IF;
    END $$;
  `);

  clienteEstadoColumnsChecked = true;
};

let clienteDocumentoColumnChecked = false;
const ensureClienteDocumentoColumn = async () => {
  if (clienteDocumentoColumnChecked) return;

  await sequelize.query(`
    ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS documento_identidad_path character varying(500) NULL
  `);

  clienteDocumentoColumnChecked = true;
};

let clienteDocumentosTableChecked = false;
const ensureClienteDocumentosTable = async () => {
  if (clienteDocumentosTableChecked) return;

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS public.cliente_documentos (
      id uuid PRIMARY KEY,
      cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
      tipo character varying(30) NOT NULL DEFAULT 'IDENTIDAD',
      nombre character varying(255) NOT NULL,
      mime_type character varying(100) NOT NULL DEFAULT 'application/pdf',
      size_bytes integer NULL,
      ruta character varying(500) NOT NULL,
      creado_en timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_cliente_documentos_cliente_tipo
    ON public.cliente_documentos (cliente_id, tipo)
  `);

  clienteDocumentosTableChecked = true;
};

const getLatestClienteDocumentoIdentidad = async (clienteId) => {
  await ensureClienteDocumentosTable();
  const [rows] = await sequelize.query(
    `
      SELECT id, cliente_id, tipo, nombre, mime_type, size_bytes, ruta, creado_en
      FROM public.cliente_documentos
      WHERE cliente_id = :clienteId
        AND upper(coalesce(tipo, '')) = 'IDENTIDAD'
      ORDER BY creado_en DESC
      LIMIT 1
    `,
    {
      replacements: { clienteId },
      type: sequelize.QueryTypes.SELECT
    }
  );
  return rows || null;
};

const replaceClienteDocumentoIdentidad = async ({ clienteId, file, transaction = null }) => {
  if (!file) return { inserted: null, previous: [] };
  await ensureClienteDocumentosTable();

  const ruta = getClienteDocumentoPath(file);
  const nombre = String(file.originalname || file.filename || 'documento_identidad.pdf').slice(0, 255);
  const sizeBytes = Number(file.size || 0);

  const previous = await sequelize.query(
    `
      SELECT id, ruta
      FROM public.cliente_documentos
      WHERE cliente_id = :clienteId
        AND upper(coalesce(tipo, '')) = 'IDENTIDAD'
    `,
    {
      replacements: { clienteId },
      type: sequelize.QueryTypes.SELECT,
      transaction
    }
  );

  if (Array.isArray(previous) && previous.length > 0) {
    await sequelize.query(
      `
        DELETE FROM public.cliente_documentos
        WHERE cliente_id = :clienteId
          AND upper(coalesce(tipo, '')) = 'IDENTIDAD'
      `,
      {
        replacements: { clienteId },
        type: sequelize.QueryTypes.DELETE,
        transaction
      }
    );
  }

  const id = crypto.randomUUID();
  await sequelize.query(
    `
      INSERT INTO public.cliente_documentos
      (id, cliente_id, tipo, nombre, mime_type, size_bytes, ruta, creado_en)
      VALUES
      (:id, :clienteId, 'IDENTIDAD', :nombre, 'application/pdf', :sizeBytes, :ruta, NOW())
    `,
    {
      replacements: { id, clienteId, nombre, sizeBytes, ruta },
      type: sequelize.QueryTypes.INSERT,
      transaction
    }
  );

  return {
    inserted: { id, cliente_id: clienteId, tipo: 'IDENTIDAD', nombre, size_bytes: sizeBytes, ruta, creado_en: new Date() },
    previous: Array.isArray(previous) ? previous : []
  };
};

let tipoDocumentoColumnChecked = false;
let tipoDocumentoColumnAvailable = false;

const ensureSolicitudDocumentoTipoColumn = async () => {
  if (tipoDocumentoColumnChecked) {
    return tipoDocumentoColumnAvailable;
  }

  await sequelize.query(`
    ALTER TABLE public.solicitud_documentos
    ADD COLUMN IF NOT EXISTS tipo_documento character varying(30)
  `);

  tipoDocumentoColumnChecked = true;
  tipoDocumentoColumnAvailable = true;
  return true;
};

// GET /api/clientes - Listar clientes con paginación
router.get('/', authenticateToken, requirePermission('clientes.view'), async (req, res) => {
  try {
    await ensureClienteReferidosColumns();
    await ensureClienteEstadoColumns();
    await ensureClienteDocumentoColumn();
    await ensureClienteDocumentosTable();
    await ensureClienteDocumentosTable();
    const { 
      page = 1, 
      limit = 10, 
      search, 
      estado,
      format,
      sortBy = 'fecha_registro',
      sortOrder = 'DESC' 
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Construir condiciones de búsqueda
    const where = {};
    
    if (estado) {
      where.estado = estado;
    }
    
    if (search) {
      where[Op.or] = [
        { nombre: { [Op.iLike]: `%${search}%` } },
        { apellido: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { telefono: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const queryOptions = {
      where,
      order: [[sortBy, sortOrder]]
    };

    if (format !== 'csv') {
      queryOptions.limit = parseInt(limit);
      queryOptions.offset = offset;
    }

    const { count, rows: clientes } = await Cliente.findAndCountAll(queryOptions);

    // Transformar datos para incluir nombre completo
    const clientesTransformados = clientes.map(cliente => ({
      id: cliente.id,
      fecha_registro: cliente.fecha_registro,
      nombre: cliente.nombre,
      apellido: cliente.apellido,
      nombre_completo: `${cliente.nombre} ${cliente.apellido}`, // Forma alternativa
      telefono: cliente.telefono,
      email: cliente.email,
      direccion: cliente.direccion,
      nombre_contacto: cliente.nombre_contacto,
      apellido_contacto: cliente.apellido_contacto,
      telefono_contacto: cliente.telefono_contacto,
      email_contacto: cliente.email_contacto,
      direccion_contacto: cliente.direccion_contacto,
      es_referido: cliente.es_referido,
      referido_por: cliente.referido_por,
      monto_referido: cliente.monto_referido,
      descuentos_referido_disponibles: cliente.descuentos_referido_disponibles,
      descuentos_referido_aplicados: cliente.descuentos_referido_aplicados,
      estado: cliente.estado,
      motivo_estado: cliente.motivo_estado,
      observaciones: cliente.observaciones,
      documento_identidad_path: cliente.documento_identidad_path || null,
      documento_identidad_url: cliente.documento_identidad_path ? construirUrlDocumento(req, cliente.documento_identidad_path) : null
    }));

    if (format === 'csv') {
      return sendCsv(res, {
        filename: `clientes_${Date.now()}.csv`,
        headers: [
          { key: 'id', label: 'id' },
          { key: 'fecha_registro', label: 'fecha_registro' },
          { key: 'nombre', label: 'nombre' },
          { key: 'apellido', label: 'apellido' },
          { key: 'nombre_completo', label: 'nombre_completo' },
          { key: 'telefono', label: 'telefono' },
          { key: 'email', label: 'email' },
          { key: 'direccion', label: 'direccion' },
          { key: 'es_referido', label: 'es_referido' },
          { key: 'referido_por', label: 'referido_por' },
          { key: 'monto_referido', label: 'monto_referido' },
          { key: 'descuentos_referido_disponibles', label: 'descuentos_referido_disponibles' },
          { key: 'descuentos_referido_aplicados', label: 'descuentos_referido_aplicados' },
          { key: 'estado', label: 'estado' },
          { key: 'motivo_estado', label: 'motivo_estado' },
          { key: 'observaciones', label: 'observaciones' },
          { key: 'documento_identidad_path', label: 'documento_identidad_path' },
          { key: 'documento_identidad_url', label: 'documento_identidad_url' }
        ],
        rows: clientesTransformados
      });
    }

    res.json({
      success: true,
      data: clientesTransformados,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error obteniendo clientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo clientes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PATCH /api/clientes/:id/estado - Cambiar estado del cliente
router.patch('/:id/estado', authenticateToken, requirePermission('clientes.edit'), async (req, res) => {
  try {
    await ensureClienteEstadoColumns();
    await ensureClienteDocumentoColumn();
    const { id } = req.params;
    const estado = String(req.body?.estado || '').trim().toUpperCase();
    const motivoRaw = req.body?.motivo;
    const motivo = typeof motivoRaw === 'string' ? motivoRaw.trim() : null;

    if (!ESTADOS_CLIENTE_PERMITIDOS.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: `Estado inválido. Valores permitidos: ${ESTADOS_CLIENTE_PERMITIDOS.join(', ')}`
      });
    }

    const cliente = await Cliente.findByPk(id);
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    await cliente.update({
      estado,
      motivo_estado: motivo || null
    });

    return res.json({
      success: true,
      message: 'Estado actualizado',
      data: {
        id: cliente.id,
        estado: cliente.estado,
        motivo_estado: cliente.motivo_estado || null,
        updated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error actualizando estado de cliente:', error);
    return res.status(500).json({
      success: false,
      message: 'Error actualizando estado de cliente'
    });
  }
});

// POST /api/clientes/verificacion-email/enviar - Enviar OTP al correo
router.post('/verificacion-email/enviar', async (req, res) => {
  try {
    const email = normalizarEmail(req.body?.email);

    if (!email || !validarFormatoEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Email inválido'
      });
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

    let sendCount = verificacion?.send_count || 0;
    const lastSentAt = verificacion?.last_sent_at ? new Date(verificacion.last_sent_at) : null;
    if (!lastSentAt || (ahora.getTime() - lastSentAt.getTime()) > (60 * 60 * 1000)) {
      sendCount = 0;
    }

    if (sendCount >= OTP_MAX_SENDS_PER_HOUR) {
      return res.status(429).json({
        success: false,
        message: 'Rate limit excedido. Intenta nuevamente más tarde'
      });
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
        send_count: sendCount + 1,
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
    console.error('Error enviando OTP de verificación de correo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error enviando código de verificación'
    });
  }
});

// GET /api/clientes/verificacion-email/debug-smtp - Diagnóstico temporal SMTP
router.get('/verificacion-email/debug-smtp', async (req, res) => {
  try {
    if (!validateDebugSmtpToken(req)) {
      return res.status(403).json({
        success: false,
        message: 'No autorizado para diagnóstico SMTP.'
      });
    }

    const config = await verifySmtpConfig();

    return res.json({
      success: true,
      message: 'SMTP verificado correctamente.',
      data: config
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Fallo al verificar SMTP.',
      diagnostic: {
        code: error?.code || null,
        responseCode: error?.responseCode || null,
        command: error?.command || null,
        response: error?.response || null,
        error: error?.message || 'SMTP verification error'
      }
    });
  }
});

// POST /api/clientes/verificacion-email/verificar - Verificar OTP
router.post('/verificacion-email/verificar', async (req, res) => {
  try {
    const email = normalizarEmail(req.body?.email);
    const codigo = String(req.body?.codigo || '').trim();

    if (!email || !validarFormatoEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Email inválido'
      });
    }

    if (!codigo || !/^\d{6}$/.test(codigo)) {
      return res.status(400).json({
        success: false,
        message: 'Código inválido'
      });
    }

    const verificacion = await ClienteEmailVerificacion.findOne({ where: { email } });
    if (!verificacion || !verificacion.codigo_hash) {
      return res.status(400).json({
        success: false,
        message: 'Código inválido'
      });
    }

    if ((verificacion.intentos || 0) >= (verificacion.max_intentos || OTP_MAX_ATTEMPTS)) {
      return res.status(429).json({
        success: false,
        message: 'Demasiados intentos'
      });
    }

    if (!verificacion.expires_at || new Date(verificacion.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'Código expirado'
      });
    }

    const expectedHash = buildOtpHash(email, codigo);
    if (!timingSafeEqual(expectedHash, verificacion.codigo_hash)) {
      await verificacion.update({
        intentos: (verificacion.intentos || 0) + 1,
        updated_at: new Date()
      });
      return res.status(400).json({
        success: false,
        message: 'Código inválido'
      });
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
    console.error('Error verificando OTP de correo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verificando correo'
    });
  }
});

// GET /api/clientes/:id - Obtener cliente por ID
router.get('/:id', authenticateToken, requirePermission('clientes.view'), async (req, res) => {
  try {
    await ensureClienteReferidosColumns();
    await ensureClienteDocumentoColumn();
    await ensureClienteDocumentosTable();
    const cliente = await Cliente.findByPk(req.params.id);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }
    
    const raw = cliente.toJSON();
    const identityDoc = await getLatestClienteDocumentoIdentidad(raw.id);
    const documentoIdentidad = buildClienteDocumentoIdentity(req, raw, identityDoc);
    res.json({
      success: true,
      data: {
        ...raw,
        documento_identidad_path: raw.documento_identidad_path || null,
        ...documentoIdentidad
      }
    });
  } catch (error) {
    console.error('Error obteniendo cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo cliente'
    });
  }
});

// GET /api/clientes/:id/documento-identidad/download - Descargar/visualizar documento identidad (protegido)
router.get('/:id/documento-identidad/download', authenticateToken, requirePermission('clientes.view'), async (req, res) => {
  try {
    await ensureClienteDocumentoColumn();
    await ensureClienteDocumentosTable();
    const cliente = await Cliente.findByPk(req.params.id, {
      attributes: ['id', 'documento_identidad_path']
    });

    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    const identityDoc = await getLatestClienteDocumentoIdentidad(cliente.id);
    const relativePath = identityDoc?.ruta || cliente.documento_identidad_path;
    const availability = getDocumentStorageState(relativePath);

    if (!availability.valid || !availability.relativePath) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no tiene documento de identidad cargado'
      });
    }

    const absolutePath = availability.absolutePath;
    if (!availability.exists) {
      return res.status(404).json({
        success: false,
        message: 'Documento de identidad no disponible en el servidor'
      });
    }

    const disposition = String(req.query?.disposition || 'inline').toLowerCase() === 'attachment' ? 'attachment' : 'inline';
    const filename = path.basename(availability.relativePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    return res.sendFile(absolutePath);
  } catch (error) {
    console.error('Error descargando documento de identidad:', error);
    return res.status(500).json({
      success: false,
      message: 'Error descargando documento de identidad'
    });
  }
});

// GET /api/clientes/:clienteId/documentos - Documentos PDF del cliente
router.get('/:clienteId/documentos', authenticateToken, requirePermission('clientes.view'), async (req, res) => {
  try {
    await ensureSolicitudDocumentoTipoColumn();
    await ensureClienteDocumentoColumn();
    await ensureClienteDocumentosTable();
    const { clienteId } = req.params;

    const cliente = await Cliente.findByPk(clienteId);
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no existe'
      });
    }

    const solicitudes = await Solicitud.findAll({
      where: { cliente_id: clienteId },
      attributes: ['id', 'cliente_id'],
      include: [
        {
          model: SolicitudDocumento,
          as: 'documentos',
          attributes: ['id', 'nombre_original', 'mime_type', 'tipo_documento', 'ruta', 'size_bytes', 'creado_en']
        }
      ],
      order: [['creado_en', 'DESC']]
    });

    const documentos = solicitudes.flatMap((solicitud) => {
      const docs = Array.isArray(solicitud.documentos) ? solicitud.documentos : [];
      return docs.map((doc) => {
        const disponibilidad = getDocumentStorageState(doc.ruta);
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const urlVer = disponibilidad.exists
          ? `${baseUrl}/api/documentos/${doc.id}/download?disposition=inline`
          : null;
        const urlDescarga = disponibilidad.exists
          ? `${baseUrl}/api/documentos/${doc.id}/download?disposition=attachment`
          : null;

        return {
          id: doc.id,
          cliente_id: solicitud.cliente_id,
          solicitud_id: solicitud.id,
          nombre: doc.nombre_original,
          tipo: 'PDF',
          categoria: doc.tipo_documento || null,
          tipo_documento: doc.tipo_documento || null,
          mime_type: doc.mime_type,
          storage_path: disponibilidad.relativePath,
          storage_key: disponibilidad.relativePath,
          exists: disponibilidad.exists,
          archivo_disponible: disponibilidad.exists,
          url: disponibilidad.exists ? construirUrlDocumento(req, disponibilidad.relativePath) : null,
          url_ver: urlVer,
          download_url: urlDescarga,
          url_descarga: urlDescarga,
          delete_url: `${baseUrl}/api/documentos/${doc.id}`,
          size_bytes: doc.size_bytes,
          fecha_subida: doc.creado_en
        };
      });
    });

    const documentosCliente = await sequelize.query(
      `
        SELECT id, cliente_id, tipo, nombre, mime_type, size_bytes, ruta, creado_en
        FROM public.cliente_documentos
        WHERE cliente_id = :clienteId
        ORDER BY creado_en DESC
      `,
      {
        replacements: { clienteId },
        type: sequelize.QueryTypes.SELECT
      }
    );

    const documentosIdentidad = (documentosCliente || []).map((doc) => {
      const disponibilidad = getDocumentStorageState(doc.ruta);
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const urlDocumentos = disponibilidad.exists
        ? `${baseUrl}/api/clientes/${doc.cliente_id}/documento-identidad/download?disposition=inline`
        : null;
      const urlDescarga = disponibilidad.exists
        ? `${baseUrl}/api/clientes/${doc.cliente_id}/documento-identidad/download?disposition=attachment`
        : null;

      return {
        id: doc.id,
        cliente_id: doc.cliente_id,
        solicitud_id: null,
        nombre: doc.nombre,
        tipo: 'PDF',
        categoria: doc.tipo || 'IDENTIDAD',
        tipo_documento: doc.tipo || 'IDENTIDAD',
        mime_type: doc.mime_type || 'application/pdf',
        storage_path: disponibilidad.relativePath,
        storage_key: disponibilidad.relativePath,
        exists: disponibilidad.exists,
        archivo_disponible: disponibilidad.exists,
        url: disponibilidad.exists ? construirUrlDocumento(req, disponibilidad.relativePath) : null,
        url_ver: urlDocumentos,
        download_url: urlDescarga,
        url_descarga: urlDescarga,
        delete_url: `${baseUrl}/api/documentos/${doc.id}`,
        size_bytes: doc.size_bytes,
        fecha_subida: doc.creado_en
      };
    });

    const documentosUnicos = deduplicateDocuments([...documentosIdentidad, ...documentos]);
    const documentosDisponibles = documentosUnicos.filter((doc) => doc.exists !== false);

    return res.json({
      success: true,
      data: documentosDisponibles,
      meta: {
        total: documentosUnicos.length,
        disponibles: documentosDisponibles.length,
        huerfanos: documentosUnicos.length - documentosDisponibles.length
      }
    });
  } catch (error) {
    console.error('Error obteniendo documentos del cliente:', error);
    return res.status(500).json({
      success: false,
      message: 'Error obteniendo documentos del cliente'
    });
  }
});

// GET /api/clientes/:id/prestamos - Historial de préstamos del cliente (paginado)
router.get('/:id/prestamos', authenticateToken, requirePermission('prestamos.view'), async (req, res) => {
  try {
    await ensureClienteDocumentoColumn();
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const cliente = await Cliente.findByPk(id);
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    const { count, rows } = await Prestamo.findAndCountAll({
      include: [
        {
          model: Solicitud,
          as: 'solicitud',
          where: { cliente_id: id },
          required: true
        }
      ],
      order: [['fecha_inicio', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    const prestamos = rows.map((prestamo) => ({
      ...prestamo.toJSON(),
      cliente_id: prestamo?.solicitud?.cliente_id || null,
      saldo_pendiente: resolveSaldoPendiente(prestamo.toJSON())
    }));

    return res.json({
      success: true,
      data: prestamos,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error obteniendo historial de préstamos:', error);
    return res.status(500).json({
      success: false,
      message: 'Error obteniendo historial de préstamos'
    });
  }
});

// GET /api/clientes/:id/score-comportamiento
router.get('/:id/score-comportamiento', authenticateToken, requirePermission('clientes.view'), async (req, res) => {
  try {
    await ensureClienteDocumentoColumn();
    const { id } = req.params;
    const cliente = await Cliente.findByPk(id, { attributes: ['id', 'nombre', 'apellido'] });
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado',
        code: 'CLIENT_NOT_FOUND'
      });
    }

    const cuotas = await Cuota.findAll({
      include: [
        {
          model: Prestamo,
          as: 'prestamo',
          required: true,
          include: [
            {
              model: Solicitud,
              as: 'solicitud',
              required: true,
              where: { cliente_id: id },
              attributes: []
            }
          ],
          attributes: []
        }
      ],
      attributes: ['id', 'fecha_vencimiento', 'fecha_pago', 'monto_total', 'monto_pagado']
    });

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const totalCuotas = cuotas.length;
    let pagosPuntuales = 0;
    let pagosTarde = 0;
    let vencidasNoPagadas = 0;
    let sumaDiasAtraso = 0;
    let eventosAtraso = 0;

    cuotas.forEach((cuota) => {
      const fechaV = new Date(cuota.fecha_vencimiento);
      fechaV.setHours(0, 0, 0, 0);
      const montoTotal = parseFloat(cuota.monto_total || 0);
      const montoPagado = parseFloat(cuota.monto_pagado || 0);
      const pagadaCompleta = montoPagado >= montoTotal && montoTotal > 0;
      const fechaPago = cuota.fecha_pago ? new Date(cuota.fecha_pago) : null;
      if (fechaPago) fechaPago.setHours(0, 0, 0, 0);

      if (pagadaCompleta && fechaPago && fechaPago <= fechaV) {
        pagosPuntuales += 1;
        return;
      }

      if (pagadaCompleta && fechaPago && fechaPago > fechaV) {
        pagosTarde += 1;
        const dias = Math.ceil((fechaPago.getTime() - fechaV.getTime()) / (1000 * 60 * 60 * 24));
        sumaDiasAtraso += Math.max(dias, 0);
        eventosAtraso += 1;
        return;
      }

      const saldo = Math.max(montoTotal - montoPagado, 0);
      if (saldo > 0 && fechaV < hoy) {
        vencidasNoPagadas += 1;
        const dias = Math.ceil((hoy.getTime() - fechaV.getTime()) / (1000 * 60 * 60 * 24));
        sumaDiasAtraso += Math.max(dias, 0);
        eventosAtraso += 1;
      }
    });

    if (totalCuotas < 3) {
      return res.json({
        success: true,
        data: {
          cliente_id: id,
          behavior_score: null,
          behavior_rating: null,
          insuficiente_historial: true,
          metricas: {
            total_pagos: totalCuotas,
            pagos_puntuales: pagosPuntuales,
            pagos_tarde: pagosTarde,
            cuotas_vencidas_no_pagadas: vencidasNoPagadas,
            dias_atraso_promedio: eventosAtraso > 0 ? parseFloat((sumaDiasAtraso / eventosAtraso).toFixed(2)) : 0,
            porcentaje_puntualidad: totalCuotas > 0 ? parseFloat(((pagosPuntuales / totalCuotas) * 100).toFixed(2)) : 0
          }
        }
      });
    }

    const porcentajePuntualidad = totalCuotas > 0 ? (pagosPuntuales / totalCuotas) * 100 : 0;
    const porcentajeTarde = totalCuotas > 0 ? (pagosTarde / totalCuotas) * 100 : 0;
    const porcentajeVencidas = totalCuotas > 0 ? (vencidasNoPagadas / totalCuotas) * 100 : 0;
    const diasAtrasoPromedio = eventosAtraso > 0 ? (sumaDiasAtraso / eventosAtraso) : 0;

    const scoreRaw = 100
      - (porcentajeTarde * 0.35)
      - (porcentajeVencidas * 0.55)
      - (diasAtrasoPromedio * 1.25);
    const behaviorScore = Math.max(0, Math.min(100, Math.round(scoreRaw)));
    const behaviorRating = behaviorScore >= 90 ? 'A' : behaviorScore >= 75 ? 'B' : behaviorScore >= 60 ? 'C' : 'D';

    return res.json({
      success: true,
      data: {
        cliente_id: id,
        behavior_score: behaviorScore,
        behavior_rating: behaviorRating,
        insuficiente_historial: false,
        metricas: {
          total_pagos: totalCuotas,
          pagos_puntuales: pagosPuntuales,
          pagos_tarde: pagosTarde,
          cuotas_vencidas_no_pagadas: vencidasNoPagadas,
          dias_atraso_promedio: parseFloat(diasAtrasoPromedio.toFixed(2)),
          porcentaje_puntualidad: parseFloat(porcentajePuntualidad.toFixed(2))
        }
      }
    });
  } catch (error) {
    console.error('Error calculando score de comportamiento:', error);
    return res.status(500).json({
      success: false,
      message: 'Error calculando score de comportamiento'
    });
  }
});

// POST /api/clientes - Crear cliente
router.post(
  '/',
  authenticateToken,
  requirePermission('clientes.create'),
  uploadDocumentoIdentidadOpcional,
  async (req, res) => {
  try {
    await ensureClienteReferidosColumns();
    await ensureClienteEstadoColumns();
    await ensureClienteDocumentoColumn();
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
    } = req.body;
    const documentoIdentidadPath = getClienteDocumentoPath(req.file);

    // Validaciones básicas
    if (!nombre || !apellido) {
      return res.status(400).json({
        success: false,
        message: 'Nombre y apellido son requeridos'
      });
    }

    const emailNormalizado = email ? normalizarEmail(email) : null;
    if (emailNormalizado && !validarFormatoEmail(emailNormalizado)) {
      return res.status(400).json({
        success: false,
        message: 'Email inválido'
      });
    }

    if (emailNormalizado) {
      const verificacion = await ClienteEmailVerificacion.findOne({ where: { email: emailNormalizado } });
      const isVerified = Boolean(verificacion?.verified);
      const verifiedAtMs = verificacion?.verified_at ? new Date(verificacion.verified_at).getTime() : 0;
      const verificationWindowMs = 24 * 60 * 60 * 1000;

      if (!isVerified || !verifiedAtMs || (Date.now() - verifiedAtMs) > verificationWindowMs) {
        return res.status(400).json({
          success: false,
          message: 'El correo no ha sido verificado'
        });
      }
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

    const estadoNormalizado = estado ? String(estado).trim().toUpperCase() : 'ACTIVO';
    if (!ESTADOS_CLIENTE_PERMITIDOS.includes(estadoNormalizado)) {
      return res.status(400).json({
        success: false,
        message: `Estado inválido. Valores permitidos: ${ESTADOS_CLIENTE_PERMITIDOS.join(', ')}`
      });
    }

    const cliente = await sequelize.transaction(async (transaction) => {
      const nuevoCliente = await Cliente.create({
        nombre,
        apellido,
        telefono,
        email: emailNormalizado,
        direccion,
        nombre_contacto,
        apellido_contacto,
        telefono_contacto,
        email_contacto,
        direccion_contacto,
        es_referido: referidoFlag,
        referido_por: referidoPorValue,
        monto_referido: parseFloat((referidoFlag ? montoReferidoNumero : 0).toFixed(2)),
        descuentos_referido_disponibles: referidoFlag && montoReferidoNumero > 0 ? 1 : 0,
        descuentos_referido_aplicados: 0,
        estado: estadoNormalizado,
        observaciones,
        documento_identidad_path: documentoIdentidadPath,
        fecha_registro: new Date()
      }, { transaction });

      if (referidoPorValue) {
        const referidor = await buscarClienteReferidor(referidoPorValue, transaction);
        if (referidor && referidor.id !== nuevoCliente.id) {
          await referidor.update({
            descuentos_referido_disponibles: (parseInt(referidor.descuentos_referido_disponibles, 10) || 0) + 1
          }, { transaction });
        }
      }

      if (req.file) {
        await replaceClienteDocumentoIdentidad({
          clienteId: nuevoCliente.id,
          file: req.file,
          transaction
        });
      }

      return nuevoCliente;
    });

    if (emailNormalizado) {
      await ClienteEmailVerificacion.update(
        { verified: false, verified_at: null, updated_at: new Date() },
        { where: { email: emailNormalizado } }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Cliente creado exitosamente',
      data: {
        ...cliente.toJSON(),
        ...buildClienteDocumentoIdentity(req, cliente.toJSON(), await getLatestClienteDocumentoIdentidad(cliente.id))
      }
    });
  } catch (error) {
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => null);
    }
    console.error('Error creando cliente:', error);
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'El email ya está registrado'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error creando cliente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PUT /api/clientes/:id - Actualizar cliente
router.put(
  '/:id',
  authenticateToken,
  requirePermission('clientes.edit'),
  uploadDocumentoIdentidadOpcional,
  async (req, res) => {
  try {
    await ensureClienteReferidosColumns();
    await ensureClienteEstadoColumns();
    await ensureClienteDocumentoColumn();
    const cliente = await Cliente.findByPk(req.params.id);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    const updates = {};
    const camposPermitidos = [
      'nombre', 'apellido', 'telefono', 'email', 'direccion',
      'nombre_contacto', 'apellido_contacto', 'telefono_contacto',
      'email_contacto', 'direccion_contacto', 'es_referido',
      'referido_por', 'monto_referido', 'descuentos_referido_disponibles',
      'descuentos_referido_aplicados', 'estado', 'motivo_estado', 'observaciones'
    ];

    // Solo actualizar campos permitidos que estén presentes en el body
    camposPermitidos.forEach(campo => {
      if (req.body[campo] !== undefined) {
        updates[campo] = req.body[campo];
      }
    });

    if (updates.estado !== undefined) {
      updates.estado = String(updates.estado).trim().toUpperCase();
      if (!ESTADOS_CLIENTE_PERMITIDOS.includes(updates.estado)) {
        return res.status(400).json({
          success: false,
          message: `Estado inválido. Valores permitidos: ${ESTADOS_CLIENTE_PERMITIDOS.join(', ')}`
        });
      }
    }

    if (updates.monto_referido !== undefined) {
      const montoReferidoNumero = parseFloat(updates.monto_referido);
      if (Number.isNaN(montoReferidoNumero) || montoReferidoNumero < 0) {
        return res.status(400).json({
          success: false,
          message: 'monto_referido debe ser un número mayor o igual a 0'
        });
      }
      updates.monto_referido = parseFloat(montoReferidoNumero.toFixed(2));
    }

    if (updates.descuentos_referido_disponibles !== undefined) {
      const valor = parseInt(updates.descuentos_referido_disponibles, 10);
      if (!Number.isFinite(valor) || valor < 0) {
        return res.status(400).json({
          success: false,
          message: 'descuentos_referido_disponibles debe ser mayor o igual a 0'
        });
      }
      updates.descuentos_referido_disponibles = valor;
    }

    if (updates.descuentos_referido_aplicados !== undefined) {
      const valor = parseInt(updates.descuentos_referido_aplicados, 10);
      if (!Number.isFinite(valor) || valor < 0) {
        return res.status(400).json({
          success: false,
          message: 'descuentos_referido_aplicados debe ser mayor o igual a 0'
        });
      }
      updates.descuentos_referido_aplicados = valor;
    }

    if (updates.es_referido !== undefined) {
      updates.es_referido = updates.es_referido === true || updates.es_referido === 'true' || updates.es_referido === 1 || updates.es_referido === '1';
    }

    if (updates.referido_por !== undefined && (updates.referido_por === '' || updates.referido_por === null)) {
      updates.referido_por = null;
    } else if (updates.referido_por !== undefined) {
      updates.referido_por = String(updates.referido_por).trim() || null;
    }

    if (updates.es_referido === false) {
      updates.referido_por = null;
      if (updates.monto_referido === undefined) {
        updates.monto_referido = 0;
      }
    }

    const nuevoDocumentoPath = getClienteDocumentoPath(req.file);
    if (nuevoDocumentoPath) {
      updates.documento_identidad_path = nuevoDocumentoPath;
    }

    const documentoAnterior = cliente.documento_identidad_path;
    let previousIdentityDocs = [];

    await sequelize.transaction(async (transaction) => {
      await cliente.update(updates, { transaction });

      if (req.file) {
        const replaced = await replaceClienteDocumentoIdentidad({
          clienteId: cliente.id,
          file: req.file,
          transaction
        });
        previousIdentityDocs = replaced.previous || [];
      }
    });

    if (nuevoDocumentoPath && documentoAnterior && documentoAnterior !== nuevoDocumentoPath) {
      const rutaAnteriorAbs = path.join(__dirname, '..', '..', documentoAnterior);
      fs.promises.unlink(rutaAnteriorAbs).catch(() => null);
    }

    if (Array.isArray(previousIdentityDocs) && previousIdentityDocs.length > 0) {
      previousIdentityDocs.forEach((doc) => {
        if (!doc?.ruta || doc.ruta === nuevoDocumentoPath) return;
        const oldPath = resolveAbsoluteUploadPath(doc.ruta);
        fs.promises.unlink(oldPath).catch(() => null);
      });
    }

    res.json({
      success: true,
      message: 'Cliente actualizado exitosamente',
      data: {
        ...cliente.toJSON(),
        ...buildClienteDocumentoIdentity(req, cliente.toJSON(), await getLatestClienteDocumentoIdentidad(cliente.id))
      }
    });
  } catch (error) {
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => null);
    }
    console.error('Error actualizando cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error actualizando cliente'
    });
  }
});

// DELETE /api/clientes/:id/hard-delete - Eliminación física real solo para administradores
router.delete('/:id/hard-delete', authenticateToken, async (req, res) => {
  try {
    return performClienteHardDelete(req, res, req.params.id);
  } catch (error) {
    console.error('Error realizando hard delete de cliente:', error);
    return res.status(500).json({
      success: false,
      message: 'Error eliminando físicamente el cliente'
    });
  }
});

// DELETE /api/clientes/:id - Eliminación física real solo para administradores
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    return performClienteHardDelete(req, res, req.params.id);
  } catch (error) {
    console.error('Error realizando hard delete de cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error eliminando físicamente el cliente'
    });
  }
});

// GET /api/clientes/search/:term - Buscar clientes
router.get('/search/:term', authenticateToken, requirePermission('clientes.view'), async (req, res) => {
  try {
    await ensureClienteDocumentoColumn();
    const { term } = req.params;
    
    const clientes = await Cliente.findAll({
      where: {
        [Op.or]: [
          { nombre: { [Op.iLike]: `%${term}%` } },
          { apellido: { [Op.iLike]: `%${term}%` } },
          { email: { [Op.iLike]: `%${term}%` } },
          { telefono: { [Op.iLike]: `%${term}%` } }
        ]
      },
      limit: 20
    });

    res.json({
      success: true,
      data: clientes
    });
  } catch (error) {
    console.error('Error buscando clientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error buscando clientes'
    });
  }
});

// GET /api/clientes/stats/estadisticas - Estadísticas de clientes
router.get('/stats/estadisticas', authenticateToken, requirePermission('clientes.view'), async (req, res) => {
  try {
    await ensureClienteDocumentoColumn();
    const totalClientes = await Cliente.count();
    const clientesActivos = await Cliente.count({ where: { estado: 'ACTIVO' } });
    const clientesInactivos = await Cliente.count({ where: { estado: 'INACTIVO' } });
    
    // Clientes registrados este mes
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    
    const clientesEsteMes = await Cliente.count({
      where: {
        fecha_registro: {
          [Op.gte]: inicioMes
        }
      }
    });

    res.json({
      success: true,
      data: {
        total: totalClientes,
        activos: clientesActivos,
        inactivos: clientesInactivos,
        este_mes: clientesEsteMes,
        porcentaje_activos: totalClientes > 0 ? ((clientesActivos / totalClientes) * 100).toFixed(2) : 0
      }
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas'
    });
  }
});

module.exports = router;
