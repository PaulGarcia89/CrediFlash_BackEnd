const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Cliente, Prestamo, Solicitud, SolicitudDocumento, ClienteEmailVerificacion, sequelize } = require('../models');
const { Op } = require('sequelize');
const { sendCsv } = require('../utils/exporter');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { sendOtpVerificationEmail } = require('../utils/emailVerificationService');

const OTP_EXPIRES_SECONDS = 600;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MIN_RESEND_SECONDS = 60;
const OTP_MAX_SENDS_PER_HOUR = 5;

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

const construirUrlDocumento = (req, rutaRelativa = '') => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const rutaNormalizada = String(rutaRelativa || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return `${baseUrl}/${rutaNormalizada}`;
};

const deduplicarDocumentosPorId = (documentos = []) => {
  const map = new Map();
  documentos.forEach((doc) => {
    if (doc?.id && !map.has(doc.id)) {
      map.set(doc.id, doc);
    }
  });
  return Array.from(map.values());
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      observaciones: cliente.observaciones
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
          { key: 'observaciones', label: 'observaciones' }
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
    const cliente = await Cliente.findByPk(req.params.id);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }
    
    res.json({
      success: true,
      data: cliente
    });
  } catch (error) {
    console.error('Error obteniendo cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo cliente'
    });
  }
});

// GET /api/clientes/:clienteId/documentos - Documentos PDF del cliente
router.get('/:clienteId/documentos', authenticateToken, requirePermission('clientes.view'), async (req, res) => {
  try {
    await ensureSolicitudDocumentoTipoColumn();
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
      return docs.map((doc) => ({
        id: doc.id,
        cliente_id: solicitud.cliente_id,
        solicitud_id: solicitud.id,
        nombre: doc.nombre_original,
        tipo: 'PDF',
        categoria: doc.tipo_documento || null,
        tipo_documento: doc.tipo_documento || null,
        mime_type: doc.mime_type,
        url: construirUrlDocumento(req, doc.ruta),
        url_ver: `${req.protocol}://${req.get('host')}/api/documentos/${doc.id}/download?disposition=inline`,
        download_url: `${req.protocol}://${req.get('host')}/api/documentos/${doc.id}/download?disposition=attachment`,
        url_descarga: `${req.protocol}://${req.get('host')}/api/documentos/${doc.id}/download?disposition=attachment`,
        delete_url: `${req.protocol}://${req.get('host')}/api/documentos/${doc.id}`,
        size_bytes: doc.size_bytes,
        fecha_subida: doc.creado_en
      }));
    });

    const documentosUnicos = deduplicarDocumentosPorId(documentos);

    return res.json({
      success: true,
      data: documentosUnicos
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
      cliente_id: prestamo?.solicitud?.cliente_id || null
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

// POST /api/clientes - Crear cliente
router.post('/', authenticateToken, requirePermission('clientes.create'), async (req, res) => {
  try {
    await ensureClienteReferidosColumns();
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
        estado: estado || 'ACTIVO',
        observaciones,
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
      data: cliente
    });
  } catch (error) {
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
router.put('/:id', authenticateToken, requirePermission('clientes.edit'), async (req, res) => {
  try {
    await ensureClienteReferidosColumns();
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
      'descuentos_referido_aplicados', 'estado', 'observaciones'
    ];

    // Solo actualizar campos permitidos que estén presentes en el body
    camposPermitidos.forEach(campo => {
      if (req.body[campo] !== undefined) {
        updates[campo] = req.body[campo];
      }
    });

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

    await cliente.update(updates);

    res.json({
      success: true,
      message: 'Cliente actualizado exitosamente',
      data: cliente
    });
  } catch (error) {
    console.error('Error actualizando cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error actualizando cliente'
    });
  }
});

// DELETE /api/clientes/:id - Eliminar cliente (cambiar estado a INACTIVO)
router.delete('/:id', authenticateToken, requirePermission('clientes.edit'), async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    // En lugar de eliminar, cambiar estado a INACTIVO
    await cliente.update({ estado: 'INACTIVO' });

    res.json({
      success: true,
      message: 'Cliente marcado como INACTIVO'
    });
  } catch (error) {
    console.error('Error eliminando cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error eliminando cliente'
    });
  }
});

// GET /api/clientes/search/:term - Buscar clientes
router.get('/search/:term', authenticateToken, requirePermission('clientes.view'), async (req, res) => {
  try {
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
