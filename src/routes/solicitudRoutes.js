const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const { Solicitud, SolicitudDocumento, Cliente, Analista, ModeloAprobacion, Prestamo, Cuota, sequelize } = require('../models');
const { Op } = require('sequelize');
const { sendCsv } = require('../utils/exporter');
const { calcularTasaEfectivaPorModalidad, normalizarModalidad, MODALIDADES_PERMITIDAS } = require('../utils/tasaModalidad');

// Importar middleware desde auth
const { authenticateToken, requireRole } = require('../middleware/auth');

// ========== CONFIGURACIÓN DE CARGA DE DOCUMENTOS ==========
const DOCUMENT_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'solicitudes');

const asegurarDirectorio = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

asegurarDirectorio(DOCUMENT_UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DOCUMENT_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.pdf';
    const baseName = path
      .basename(file.originalname || 'documento', ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50);
    cb(null, `${timestamp}-${random}-${baseName}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const isPdf = file.mimetype === 'application/pdf' || path.extname(file.originalname || '').toLowerCase() === '.pdf';
  if (!isPdf) {
    return cb(new Error('Solo se permiten archivos PDF'), false);
  }
  return cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

const uploadSolicitudDocumentos = (req, res, next) => {
  upload.array('documentos', 3)(req, res, (err) => {
    if (err) {
      const esErrorTipo = String(err.message || '').toLowerCase().includes('pdf');
      const esErrorCantidad = String(err.message || '').toLowerCase().includes('unexpected');

      return res.status(400).json({
        success: false,
        message: esErrorTipo
          ? 'Tipo de archivo inválido'
          : esErrorCantidad
            ? 'Solo se permiten 0, 1, 2 o 3 documentos PDF'
            : 'Error al cargar documento',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
    return next();
  });
};

const construirUrlDocumento = (req, rutaRelativa = '') => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const rutaNormalizada = String(rutaRelativa || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return `${baseUrl}/${rutaNormalizada}`;
};

const formatearDocumento = (req, doc, solicitudId = null, clienteId = null) => ({
  id: doc.id,
  solicitud_id: solicitudId,
  cliente_id: clienteId,
  nombre: doc.nombre_original,
  mime_type: doc.mime_type,
  tipo: doc.tipo_documento || null,
  tipo_documento: doc.tipo_documento || null,
  size_bytes: doc.size_bytes,
  storage_path: doc.ruta,
  url: construirUrlDocumento(req, doc.ruta),
  url_ver: `${req.protocol}://${req.get('host')}/api/documentos/${doc.id}/download?disposition=inline`,
  download_url: `${req.protocol}://${req.get('host')}/api/documentos/${doc.id}/download?disposition=attachment`,
  url_descarga: `${req.protocol}://${req.get('host')}/api/documentos/${doc.id}/download?disposition=attachment`,
  delete_url: `${req.protocol}://${req.get('host')}/api/documentos/${doc.id}`,
  created_at: doc.creado_en
});

const deduplicarDocumentosPorId = (documentos = []) => {
  const map = new Map();
  documentos.forEach((doc) => {
    if (doc?.id && !map.has(doc.id)) {
      map.set(doc.id, doc);
    }
  });
  return Array.from(map.values());
};

const eliminarArchivos = async (archivos = []) => {
  if (!archivos || archivos.length === 0) return;
  await Promise.all(
    archivos.map((archivo) => fs.promises.unlink(archivo.path).catch(() => null))
  );
};

const normalizarModeloCalificacion = (modeloCalificacion) => {
  if (!modeloCalificacion) return null;
  const normalizado = modeloCalificacion.trim().toUpperCase();
  const permitidos = ['CLIENTE_ANTIGUO', 'CLIENTE_NUEVO'];
  if (!permitidos.includes(normalizado)) return null;
  return normalizado;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizarTexto = (value) => String(value || '').trim();

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

const resolverModeloAprobacion = async (modeloAprobacionInput) => {
  const valor = normalizarTexto(modeloAprobacionInput);
  if (!valor) {
    throw new Error('modelo_aprobacion es requerido.');
  }

  if (UUID_REGEX.test(valor)) {
    const modeloPorId = await ModeloAprobacion.findByPk(valor);
    if (!modeloPorId) {
      throw new Error('modelo_aprobacion inválido. No existe el modelo indicado.');
    }
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

const validarYClasificarDocumentosSolicitud = (archivos = [], reqBody = {}) => {
  const tipoDocumentoIdentidad = normalizarTexto(reqBody.tipo_documento_identidad || 'ID').toUpperCase();
  const tipoDocumentosEstadoCuenta = normalizarTexto(reqBody.tipo_documentos_estado_cuenta || 'ESTADO_CUENTA').toUpperCase();

  if (tipoDocumentoIdentidad !== 'ID') {
    throw new Error('tipo_documento_identidad inválido. Debe ser ID.');
  }

  if (tipoDocumentosEstadoCuenta !== 'ESTADO_CUENTA') {
    throw new Error('tipo_documentos_estado_cuenta inválido. Debe ser ESTADO_CUENTA.');
  }

  if (archivos.length === 0) {
    throw new Error('Debe cargar un documento de identidad en PDF');
  }

  if (archivos.length < 2) {
    throw new Error('Debe cargar al menos 1 estado de cuenta en PDF');
  }

  if (archivos.length > 3) {
    throw new Error('Solo se permiten 1 o 2 estados de cuenta en PDF');
  }

  const noPdf = archivos.find((file) => file.mimetype !== 'application/pdf');
  if (noPdf) {
    throw new Error('Tipo de archivo inválido');
  }

  const [archivoIdentidad, ...archivosEstadoCuenta] = archivos;

  if (!archivoIdentidad) {
    throw new Error('Debe cargar un documento de identidad en PDF');
  }

  if (archivosEstadoCuenta.length < 1) {
    throw new Error('Debe cargar al menos 1 estado de cuenta en PDF');
  }

  if (archivosEstadoCuenta.length > 2) {
    throw new Error('Solo se permiten 1 o 2 estados de cuenta en PDF');
  }

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

const obtenerModeloAprobacionPorTipo = async (tipo) => {
  const mapa = {
    CLIENTE_ANTIGUO: 'Modelo Cliente Antiguo',
    CLIENTE_NUEVO: 'Modelo Cliente Nuevo'
  };

  const nombreModelo = mapa[tipo];
  if (!nombreModelo) return null;

  const [modelo] = await ModeloAprobacion.findOrCreate({
    where: { nombre: nombreModelo },
    defaults: {
      reglas: {},
      puntaje_minimo: 0,
      activo: true,
      creado_en: new Date()
    }
  });

  return modelo;
};

// ========== FUNCIONES DE VALIDACIÓN DE NEGOCIO ==========

async function validarClienteParaPrestamo(clienteId) {
  const cliente = await Cliente.findByPk(clienteId);
  
  if (!cliente) {
    throw new Error('Cliente no encontrado');
  }
  
  if (cliente.estado !== 'ACTIVO') {
    throw new Error(`El cliente está ${cliente.estado.toLowerCase()}. No puede solicitar préstamos.`);
  }
  
  return cliente;
}

async function validarMontoSolicitado(clienteId, montoSolicitado) {
  const montoMaximo = 50000;
  const montoNum = parseFloat(montoSolicitado) || 0;
  
  if (montoNum > montoMaximo) {
    throw new Error(`El monto solicitado (${montoNum}) excede el máximo permitido (${montoMaximo})`);
  }
  
  if (montoNum < 100) {
    throw new Error('El monto mínimo de préstamo es $100');
  }
  
  return true;
}

function calcularFechaVencimiento(plazoSemanas, fechaInicio = new Date()) {
  const fecha = new Date(fechaInicio);
  const plazoNum = parseInt(plazoSemanas) || 0;
  fecha.setDate(fecha.getDate() + plazoNum * 7);
  return fecha;
}

function calcularMontoTotal(principal, tasaAnual, plazoSemanas) {
  // Asegurar que todos sean números
  const principalNum = parseFloat(principal) || 0;
  const tasaAnualNum = parseFloat(tasaAnual) || 0;
  const plazoSemanasNum = parseInt(plazoSemanas) || 0;
  const plazoMesesEquivalente = Math.max(Math.ceil(plazoSemanasNum / 4), 1);
  
  // Calcular interés
  const tasaMensual = tasaAnualNum / 100 / 12;
  const interes = principalNum * tasaMensual * plazoMesesEquivalente;
  const total = principalNum + interes;
  
  return parseFloat(total.toFixed(2));
}

async function aprobarSolicitudYCrearPrestamo(solicitudId, analistaId) {
  console.log(`🚀 Iniciando aprobación para solicitud ${solicitudId}`);
  
  try {
    // 1. Obtener solicitud SIN transacción primero
    const solicitud = await Solicitud.findByPk(solicitudId, {
      include: [{ model: Cliente, as: 'cliente' }]
    });
    
    if (!solicitud) {
      throw new Error('Solicitud no encontrada');
    }
    
    console.log(`📊 Estado inicial: ${solicitud.estado}`);
    
    if (solicitud.estado !== 'PENDIENTE') {
      throw new Error(`La solicitud ya está ${solicitud.estado}`);
    }
    
    // 2. Actualizar solicitud primero (sin transacción)
    console.log(`🔄 Actualizando estado a APROBADO...`);
    await solicitud.update({
      estado: 'APROBADO',
      analista_id: analistaId,
      fecha_aprobacion: new Date()
    });
    
    // 3. Verificar que se actualizó
    const solicitudActualizada = await Solicitud.findByPk(solicitudId);
    console.log(`✅ Estado después de update: ${solicitudActualizada.estado}`);
    
    if (solicitudActualizada.estado !== 'APROBADO') {
      throw new Error('No se pudo actualizar el estado de la solicitud');
    }
    
    // 4. Verificar si ya existe préstamo
    const prestamoExistente = await Prestamo.findOne({
      where: { solicitud_id: solicitudId }
    });
    
    if (prestamoExistente) {
      console.log(`⚠️ Ya existe préstamo ${prestamoExistente.id}`);
      return {
        solicitud: solicitudActualizada,
        prestamo: prestamoExistente,
        mensaje: 'Solicitud aprobada (préstamo ya existía)'
      };
    }
    
    // 5. Calcular montos
    const montoTotal = calcularMontoTotal(
      solicitud.monto_solicitado,
      solicitud.tasa_variable * 100,
      solicitud.plazo_semanas
    );
    
    // 6. Crear préstamo
    console.log(`💰 Creando préstamo con monto total: ${montoTotal}`);
    const prestamo = await Prestamo.create({
      solicitud_id: solicitudId,
      fecha_inicio: new Date(),
      monto_solicitado: parseFloat(solicitud.monto_solicitado),
      interes: parseFloat(solicitud.tasa_variable * 100),
      total_pagar: montoTotal,
      pendiente: montoTotal,
      status: 'ACTIVO',
      nombre_completo: `${solicitud.cliente.nombre} ${solicitud.cliente.apellido}`,
      mes: new Date().toLocaleString('es-ES', { month: 'long' }),
      anio: new Date().getFullYear().toString(),
      modalidad: solicitud.modalidad || 'SEMANAL',
      num_semanas: parseInt(solicitud.plazo_semanas),
      fecha_vencimiento: calcularFechaVencimiento(solicitud.plazo_semanas)
    });
    
    console.log(`🎉 Préstamo creado: ${prestamo.id}`);
    
    return {
      solicitud: solicitudActualizada,
      prestamo,
      mensaje: 'Solicitud aprobada y préstamo creado exitosamente'
    };
    
  } catch (error) {
    console.error(`❌ Error crítico: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

// ========== RUTAS ==========

// POST /api/solicitudes - Crear nueva solicitud
router.post(
  '/',
  authenticateToken,
  requireRole('ANALISTA', 'SUPERVISOR', 'ADMINISTRADOR'),
  uploadSolicitudDocumentos,
  async (req, res) => {
  try {
    console.log('📥 SOLICITUD RECIBIDA:', req.body);
    
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
    } = req.body;

    // Validaciones básicas
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
    const plazo = parseInt(plazo_semanas);
    const tasaVariableNum = parseFloat(tasa_variable);

    if (isNaN(monto) || monto <= 0) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({
        success: false,
        message: 'El monto solicitado debe ser un número mayor a 0'
      });
    }

    if (isNaN(plazo) || plazo <= 0 || plazo > 520) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({
        success: false,
        message: 'El plazo en semanas debe ser un número entre 1 y 520'
      });
    }

    if (isNaN(tasaVariableNum) || tasaVariableNum <= 0) {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({
        success: false,
        message: 'tasa_variable debe ser mayor a 0'
      });
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
      return res.status(400).json({
        success: false,
        message: error.message || 'No se pudo calcular la tasa efectiva'
      });
    }

    // Verificar que el cliente existe
    const cliente = await Cliente.findByPk(cliente_id);
    if (!cliente) {
      await eliminarArchivos(req.files || []);
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }
    
    if (cliente.estado !== 'ACTIVO') {
      await eliminarArchivos(req.files || []);
      return res.status(400).json({
        success: false,
        message: `El cliente está ${cliente.estado.toLowerCase()}. No puede solicitar préstamos.`
      });
    }

    const archivos = Array.isArray(req.files) ? req.files : [];
    console.log(
      'FILES:',
      archivos.map((f) => ({ field: f.fieldname, name: f.originalname, type: f.mimetype }))
    );

    let documentosClasificados = [];
    try {
      documentosClasificados = validarYClasificarDocumentosSolicitud(archivos, req.body);
    } catch (error) {
      await eliminarArchivos(archivos);
      return res.status(400).json({
        success: false,
        message: error.message || 'Documentación inválida'
      });
    }

    let modeloAprobacionSeleccionado = null;
    try {
      modeloAprobacionSeleccionado = await resolverModeloAprobacion(modelo_aprobacion || modelo_aprobacion_id);
    } catch (error) {
      await eliminarArchivos(archivos);
      return res.status(400).json({
        success: false,
        message: error.message || 'modelo_aprobacion inválido'
      });
    }

    let modeloCalificacionNormalizado = null;
    if (modelo_calificacion !== undefined && modelo_calificacion !== null && `${modelo_calificacion}`.trim() !== '') {
      modeloCalificacionNormalizado = normalizarModeloCalificacion(modelo_calificacion);
      if (!modeloCalificacionNormalizado) {
        await eliminarArchivos(archivos);
        return res.status(400).json({
          success: false,
          message: 'modelo_calificacion inválido. Use CLIENTE_ANTIGUO o CLIENTE_NUEVO'
        });
      }
    }

    const datosSolicitud = {
      cliente_id,
      analista_id: req.user.id,
      monto_solicitado: monto,
      plazo_semanas: plazo,
      modalidad: tasasModalidad.modalidad,
      tasa_base: tasasModalidad.tasa_base,
      tasa_variable: tasasModalidad.tasa_variable,
      modelo_aprobacion_id: modeloAprobacionSeleccionado.id,
      modelo_calificacion: modeloCalificacionNormalizado,
      estado: 'PENDIENTE',
      creado_en: new Date(),
      destino: normalizarTexto(destino)
    };

    const resultado = await sequelize.transaction(async (transaction) => {
      await ensureSolicitudDocumentoTipoColumn();
      const solicitud = await Solicitud.create(datosSolicitud, { transaction });

      if (documentosClasificados.length > 0) {
        const documentosData = documentosClasificados.map(({ archivo, tipo_documento }) => ({
          solicitud_id: solicitud.id,
          nombre_original: archivo.originalname,
          nombre_archivo: archivo.filename,
          mime_type: archivo.mimetype,
          size_bytes: archivo.size,
          tipo_documento,
          ruta: path.relative(path.join(__dirname, '..', '..'), archivo.path)
        }));

        await SolicitudDocumento.bulkCreate(documentosData, { transaction });
      }

      const solicitudConCliente = await Solicitud.findByPk(solicitud.id, {
        include: [
          { 
            model: Cliente, 
            as: 'cliente',
            attributes: ['id', 'nombre', 'apellido', 'telefono', 'email', 'estado']
          },
          {
            model: ModeloAprobacion,
            as: 'modelo_aprobacion',
            attributes: ['id', 'nombre']
          },
          {
            model: SolicitudDocumento,
            as: 'documentos',
            attributes: ['id', 'nombre_original', 'nombre_archivo', 'mime_type', 'size_bytes', 'tipo_documento', 'ruta', 'creado_en']
          }
        ],
        transaction
      });

      return solicitudConCliente;
    });

    const payload = resultado.toJSON();
    const documentosEstandar = Array.isArray(payload.documentos)
      ? payload.documentos.map((doc) => formatearDocumento(req, doc, payload.id, payload.cliente_id))
      : [];

    res.status(201).json({
      success: true,
      message: 'Solicitud creada correctamente',
      data: {
        ...payload,
        modelo_aprobacion: payload?.modelo_aprobacion?.nombre || modeloAprobacionSeleccionado.nombre,
        documentos: documentosEstandar
      },
      resumen: {
        monto: `$${monto.toFixed(2)}`,
        plazo: `${plazo} semanas`,
        modalidad: tasasModalidad.modalidad,
        tasa_base: `${(tasasModalidad.tasa_base * 100).toFixed(2)}%`,
        tasa_efectiva: `${(tasasModalidad.tasa_variable * 100).toFixed(2)}%`,
        estado: 'PENDIENTE',
        documentos: documentosClasificados.length
      }
    });

  } catch (error) {
    console.error('❌ Error creando solicitud:', error);
    await eliminarArchivos(req.files || []);
    
    if (error.name === 'SequelizeValidationError') {
      const erroresValidacion = error.errors.map(err => ({
        campo: err.path,
        mensaje: err.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Error de validación de datos',
        errors: erroresValidacion
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/solicitudes - Listar todas las solicitudes
router.get('/', authenticateToken, async (req, res) => {
  try {
    await ensureSolicitudDocumentoTipoColumn();
    const { 
      page = 1, 
      limit = 20, 
      estado,
      format
    } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const where = {};
    if (estado) {
      where.estado = estado;
    }
    
    const queryOptions = {
      where,
      include: [
        { 
          model: Cliente, 
          as: 'cliente',
          attributes: ['id', 'nombre', 'apellido', 'telefono', 'email']
        },
        {
          model: ModeloAprobacion,
          as: 'modelo_aprobacion',
          attributes: ['id', 'nombre']
        },
        {
          model: SolicitudDocumento,
          as: 'documentos',
          attributes: ['id', 'nombre_original', 'nombre_archivo', 'mime_type', 'size_bytes', 'tipo_documento', 'ruta', 'creado_en']
        }
      ],
      order: [['creado_en', 'DESC']]
    };

    if (format !== 'csv') {
      queryOptions.limit = parseInt(limit);
      queryOptions.offset = offset;
    }

    const { count, rows: solicitudes } = await Solicitud.findAndCountAll(queryOptions);

    if (format === 'csv') {
      const csvRows = solicitudes.map((solicitud) => ({
        id: solicitud.id,
        cliente_id: solicitud.cliente_id,
        cliente_nombre: solicitud?.cliente ? `${solicitud.cliente.nombre} ${solicitud.cliente.apellido}` : '',
        analista_id: solicitud.analista_id,
        modelo_aprobacion_id: solicitud.modelo_aprobacion_id,
        modelo_aprobacion: solicitud?.modelo_aprobacion?.nombre || null,
        modelo_calificacion: solicitud.modelo_calificacion,
        modalidad: solicitud.modalidad || 'SEMANAL',
        monto_solicitado: solicitud.monto_solicitado,
        plazo_semanas: solicitud.plazo_semanas,
        tasa_base: solicitud.tasa_base,
        tasa_variable: solicitud.tasa_variable,
        estado: solicitud.estado,
        creado_en: solicitud.creado_en,
        destino: solicitud.destino
      }));

      return sendCsv(res, {
        filename: `solicitudes_${Date.now()}.csv`,
        headers: [
          { key: 'id', label: 'id' },
          { key: 'cliente_id', label: 'cliente_id' },
          { key: 'cliente_nombre', label: 'cliente_nombre' },
          { key: 'analista_id', label: 'analista_id' },
          { key: 'modelo_aprobacion_id', label: 'modelo_aprobacion_id' },
          { key: 'modelo_calificacion', label: 'modelo_calificacion' },
          { key: 'modalidad', label: 'modalidad' },
          { key: 'monto_solicitado', label: 'monto_solicitado' },
          { key: 'plazo_semanas', label: 'plazo_semanas' },
          { key: 'tasa_base', label: 'tasa_base' },
          { key: 'tasa_variable', label: 'tasa_variable' },
          { key: 'estado', label: 'estado' },
          { key: 'creado_en', label: 'creado_en' },
          { key: 'destino', label: 'destino' }
        ],
        rows: csvRows
      });
    }

    const solicitudesNormalizadas = solicitudes.map((item) => {
      const raw = item.toJSON ? item.toJSON() : item;
      return {
        ...raw,
        modelo_aprobacion: raw?.modelo_aprobacion?.nombre || null,
        modalidad: raw.modalidad || 'SEMANAL',
        tasa_base: raw.tasa_base ?? raw.tasa_variable,
        documentos: (raw.documentos || []).map((doc) =>
          formatearDocumento(req, doc, raw.id, raw.cliente_id)
        )
      };
    });

    res.json({
      success: true,
      data: solicitudesNormalizadas,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('❌ Error obteniendo solicitudes:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo solicitudes'
    });
  }
});

// GET /api/solicitudes/:id - Obtener solicitud por ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    await ensureSolicitudDocumentoTipoColumn();
    const solicitud = await Solicitud.findByPk(req.params.id, {
      include: [
        { 
          model: Cliente, 
          as: 'cliente',
          attributes: { exclude: ['createdAt', 'updatedAt'] }
        },
        {
          model: ModeloAprobacion,
          as: 'modelo_aprobacion',
          attributes: ['id', 'nombre']
        },
        {
          model: SolicitudDocumento,
          as: 'documentos',
          attributes: ['id', 'nombre_original', 'nombre_archivo', 'mime_type', 'size_bytes', 'tipo_documento', 'ruta', 'creado_en']
        }
      ]
    });

    if (!solicitud) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada'
      });
    }

    // Verificar si ya tiene un préstamo asociado
    let prestamoAsociado = null;
    if (solicitud.estado === 'APROBADO') {
      prestamoAsociado = await Prestamo.findOne({
        where: { solicitud_id: solicitud.id }
      });
    }

    res.json({
      success: true,
      data: {
        ...solicitud.toJSON(),
        modelo_aprobacion: solicitud?.modelo_aprobacion?.nombre || null,
        modalidad: solicitud.modalidad || 'SEMANAL',
        tasa_base: solicitud.tasa_base ?? solicitud.tasa_variable,
        documentos: (solicitud.documentos || []).map((doc) =>
          formatearDocumento(req, doc, solicitud.id, solicitud.cliente_id)
        ),
        prestamo_asociado: prestamoAsociado
      }
    });

  } catch (error) {
    console.error('❌ Error obteniendo solicitud:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo solicitud'
    });
  }
});

// PUT /api/solicitudes/:id - Actualizar solicitud (recalcula tasa por modalidad)
router.put('/:id', authenticateToken, requireRole('ANALISTA', 'SUPERVISOR', 'ADMINISTRADOR'), async (req, res) => {
  try {
    const solicitud = await Solicitud.findByPk(req.params.id);
    if (!solicitud) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada'
      });
    }

    if (solicitud.estado !== 'PENDIENTE') {
      return res.status(400).json({
        success: false,
        message: 'Solo se pueden editar solicitudes en estado PENDIENTE'
      });
    }

    const updates = {};

    if (req.body.cliente_id !== undefined) updates.cliente_id = req.body.cliente_id;
    if (req.body.monto_solicitado !== undefined) updates.monto_solicitado = parseFloat(req.body.monto_solicitado);
    if (req.body.plazo_semanas !== undefined) updates.plazo_semanas = parseInt(req.body.plazo_semanas, 10);
    if (req.body.modelo_calificacion !== undefined) updates.modelo_calificacion = req.body.modelo_calificacion || null;
    if (req.body.destino !== undefined) updates.destino = req.body.destino || null;

    if (updates.monto_solicitado !== undefined && (!Number.isFinite(updates.monto_solicitado) || updates.monto_solicitado <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'monto_solicitado debe ser mayor a 0'
      });
    }

    const plazoFinal = updates.plazo_semanas !== undefined ? updates.plazo_semanas : parseInt(solicitud.plazo_semanas, 10);
    if (!Number.isFinite(plazoFinal) || plazoFinal <= 0) {
      return res.status(400).json({
        success: false,
        message: 'plazo_semanas debe ser mayor a 0'
      });
    }

    const modalidadFinal = req.body.modalidad !== undefined
      ? normalizarModalidad(req.body.modalidad)
      : (solicitud.modalidad || 'SEMANAL');

    if (!MODALIDADES_PERMITIDAS.includes(modalidadFinal)) {
      return res.status(400).json({
        success: false,
        message: 'modalidad inválida. Valores permitidos: SEMANAL, QUINCENAL, MENSUAL.'
      });
    }

    if (updates.modelo_calificacion !== undefined && updates.modelo_calificacion !== null) {
      const modeloCalificacionNormalizado = normalizarModeloCalificacion(updates.modelo_calificacion);
      if (!modeloCalificacionNormalizado) {
        return res.status(400).json({
          success: false,
          message: 'modelo_calificacion inválido. Use CLIENTE_ANTIGUO o CLIENTE_NUEVO'
        });
      }
      updates.modelo_calificacion = modeloCalificacionNormalizado;
    }

    if (req.body.modelo_aprobacion !== undefined || req.body.modelo_aprobacion_id !== undefined) {
      try {
        const modeloAprobacion = await resolverModeloAprobacion(req.body.modelo_aprobacion || req.body.modelo_aprobacion_id);
        updates.modelo_aprobacion_id = modeloAprobacion.id;
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message || 'modelo_aprobacion inválido'
        });
      }
    }

    const tasaBaseFinal = req.body.tasa_base !== undefined
      ? req.body.tasa_base
      : (req.body.tasa_variable !== undefined ? req.body.tasa_variable : (solicitud.tasa_base ?? solicitud.tasa_variable));

    let tasasModalidad;
    try {
      tasasModalidad = resolverTasas({
        modalidad: modalidadFinal,
        plazoSemanas: plazoFinal,
        tasaBase: tasaBaseFinal
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message || 'No se pudo calcular la tasa efectiva'
      });
    }

    updates.modalidad = tasasModalidad.modalidad;
    updates.tasa_base = tasasModalidad.tasa_base;
    updates.tasa_variable = tasasModalidad.tasa_variable;

    await solicitud.update(updates);

    const solicitudActualizada = await Solicitud.findByPk(solicitud.id, {
      include: [
        {
          model: ModeloAprobacion,
          as: 'modelo_aprobacion',
          attributes: ['id', 'nombre']
        }
      ]
    });

    return res.json({
      success: true,
      message: '✅ Solicitud actualizada exitosamente',
      data: {
        ...solicitudActualizada.toJSON(),
        modelo_aprobacion: solicitudActualizada?.modelo_aprobacion?.nombre || null,
        modalidad: solicitudActualizada.modalidad || 'SEMANAL',
        tasa_base: solicitudActualizada.tasa_base ?? solicitudActualizada.tasa_variable
      }
    });
  } catch (error) {
    console.error('❌ Error actualizando solicitud:', error);
    return res.status(500).json({
      success: false,
      message: 'Error actualizando solicitud'
    });
  }
});

// POST /api/solicitudes/:id/aprobar - Aprobar solicitud Y crear préstamo
router.post('/:id/aprobar', authenticateToken, requireRole('ANALISTA', 'SUPERVISOR', 'ADMINISTRADOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { comentario } = req.body;

    console.log(`📋 Aprobando solicitud ${id} por analista ${req.user.id}`);
    
    // Ejecutar aprobación con validación de negocio
    const resultado = await aprobarSolicitudYCrearPrestamo(id, req.user.id);

    res.json({
      success: true,
      message: resultado.mensaje,
      data: {
        solicitud: resultado.solicitud,
        prestamo: resultado.prestamo,
        detalles: {
          comentario: comentario || 'Aprobado según políticas internas',
          aprobado_por: req.user.nombre + ' ' + req.user.apellido,
          fecha_aprobacion: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error('❌ Error aprobando solicitud:', error);
    
    let statusCode = 500;
    let mensajeUsuario = 'Error aprobando solicitud';
    
    if (error.message.includes('no encontrada')) {
      statusCode = 404;
      mensajeUsuario = error.message;
    } else if (error.message.includes('ya está') || error.message.includes('excede') || error.message.includes('mínimo')) {
      statusCode = 400;
      mensajeUsuario = error.message;
    } else if (error.message.includes('No puede solicitar préstamos')) {
      statusCode = 400;
      mensajeUsuario = error.message;
    }
    
    res.status(statusCode).json({
      success: false,
      message: mensajeUsuario,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/solicitudes/:id/rechazar - Rechazar solicitud
router.post('/:id/rechazar', authenticateToken, requireRole('ANALISTA', 'SUPERVISOR', 'ADMINISTRADOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { razon_rechazo } = req.body;

    const solicitud = await Solicitud.findByPk(id);
    if (!solicitud) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada'
      });
    }

    if (solicitud.estado !== 'PENDIENTE') {
      return res.status(400).json({
        success: false,
        message: `La solicitud ya está ${solicitud.estado.toLowerCase()}`
      });
    }

    if (!razon_rechazo || razon_rechazo.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar una razón de rechazo detallada (mínimo 10 caracteres)'
      });
    }

    await solicitud.update({
      estado: 'RECHAZADO',
      analista_id: req.user.id
    });

    res.json({
      success: true,
      message: '✅ Solicitud rechazada exitosamente',
      data: {
        solicitud,
        rechazo: {
          razon: razon_rechazo,
          analista: req.user.nombre + ' ' + req.user.apellido,
          fecha_rechazo: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error('❌ Error rechazando solicitud:', error);
    res.status(500).json({
      success: false,
      message: 'Error rechazando solicitud'
    });
  }
});

// POST /api/solicitudes/:id/rechazar-simple - Rechazar solicitud (sin razón)
router.post('/:id/rechazar-simple', authenticateToken, requireRole('ANALISTA', 'SUPERVISOR', 'ADMINISTRADOR'), async (req, res) => {
  try {
    const { id } = req.params;

    const solicitud = await Solicitud.findByPk(id);
    if (!solicitud) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada'
      });
    }

    if (solicitud.estado !== 'PENDIENTE') {
      return res.status(400).json({
        success: false,
        message: `La solicitud ya está ${solicitud.estado.toLowerCase()}`
      });
    }

    await solicitud.update({
      estado: 'RECHAZADO',
      analista_id: req.user.id
    });

    return res.json({
      success: true,
      message: '✅ Solicitud rechazada exitosamente',
      data: solicitud
    });
  } catch (error) {
    console.error('❌ Error rechazando solicitud (simple):', error);
    return res.status(500).json({
      success: false,
      message: 'Error rechazando solicitud'
    });
  }
});

// POST /api/solicitudes/:id/ejecutar-modelo-nuevo - Ejecutar modelo cliente nuevo
router.post(
  '/:id/ejecutar-modelo-nuevo',
  authenticateToken,
  requireRole('ANALISTA', 'SUPERVISOR', 'ADMINISTRADOR'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const solicitud = await Solicitud.findByPk(id);
      if (!solicitud) {
        return res.status(404).json({
          success: false,
          message: 'Solicitud no encontrada'
        });
      }

      if (solicitud.estado !== 'PENDIENTE') {
        return res.status(400).json({
          success: false,
          message: 'Solo se puede ejecutar modelo para solicitudes pendientes'
        });
      }

      const modelo = await obtenerModeloAprobacionPorTipo('CLIENTE_NUEVO');
      if (!modelo) {
        return res.status(500).json({
          success: false,
          message: 'No se pudo resolver el modelo de aprobación'
        });
      }

      await solicitud.update({
        modelo_aprobacion_id: modelo.id,
        modelo_calificacion: 'CLIENTE_NUEVO',
        analista_id: req.user.id
      });

      return res.json({
        success: true,
        message: 'Modelo cliente nuevo ejecutado y asignado',
        data: {
          solicitud_id: solicitud.id,
          modelo_aprobacion_id: modelo.id,
          modelo_calificacion: 'CLIENTE_NUEVO'
        }
      });
    } catch (error) {
      console.error('❌ Error ejecutando modelo cliente nuevo:', error);
      return res.status(500).json({
        success: false,
        message: 'Error ejecutando modelo cliente nuevo'
      });
    }
  }
);

// POST /api/solicitudes/:id/ejecutar-modelo-antiguo - Ejecutar modelo cliente antiguo
router.post(
  '/:id/ejecutar-modelo-antiguo',
  authenticateToken,
  requireRole('ANALISTA', 'SUPERVISOR', 'ADMINISTRADOR'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const solicitud = await Solicitud.findByPk(id);
      if (!solicitud) {
        return res.status(404).json({
          success: false,
          message: 'Solicitud no encontrada'
        });
      }

      if (solicitud.estado !== 'PENDIENTE') {
        return res.status(400).json({
          success: false,
          message: 'Solo se puede ejecutar modelo para solicitudes pendientes'
        });
      }

      const modelo = await obtenerModeloAprobacionPorTipo('CLIENTE_ANTIGUO');
      if (!modelo) {
        return res.status(500).json({
          success: false,
          message: 'No se pudo resolver el modelo de aprobación'
        });
      }

      await solicitud.update({
        modelo_aprobacion_id: modelo.id,
        modelo_calificacion: 'CLIENTE_ANTIGUO',
        analista_id: req.user.id
      });

      return res.json({
        success: true,
        message: 'Modelo cliente antiguo ejecutado y asignado',
        data: {
          solicitud_id: solicitud.id,
          modelo_aprobacion_id: modelo.id,
          modelo_calificacion: 'CLIENTE_ANTIGUO'
        }
      });
    } catch (error) {
      console.error('❌ Error ejecutando modelo cliente antiguo:', error);
      return res.status(500).json({
        success: false,
        message: 'Error ejecutando modelo cliente antiguo'
      });
    }
  }
);

// GET /api/solicitudes/cliente/:cliente_id - Obtener solicitudes de un cliente
router.get('/cliente/:cliente_id', authenticateToken, async (req, res) => {
  try {
    await ensureSolicitudDocumentoTipoColumn();
    const { cliente_id } = req.params;
    
    const cliente = await Cliente.findByPk(cliente_id);
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    const solicitudes = await Solicitud.findAll({
      where: { cliente_id },
      include: [
        { 
          model: Cliente, 
          as: 'cliente',
          attributes: ['id', 'nombre', 'apellido']
        },
        {
          model: ModeloAprobacion,
          as: 'modelo_aprobacion',
          attributes: ['id', 'nombre']
        },
        {
          model: SolicitudDocumento,
          as: 'documentos',
          attributes: ['id', 'nombre_original', 'mime_type', 'tipo_documento', 'ruta', 'size_bytes', 'creado_en']
        }
      ],
      order: [['creado_en', 'DESC']]
    });

    const solicitudesEstandarizadas = solicitudes.map((solicitud) => {
      const payload = solicitud.toJSON();
      const documentos = Array.isArray(payload.documentos) ? payload.documentos : [];
      return {
        ...payload,
        modelo_aprobacion: payload?.modelo_aprobacion?.nombre || null,
        documentos: documentos.map((doc) =>
          formatearDocumento(req, doc, payload.id, payload.cliente_id)
        )
      };
    });

    const documentosCliente = solicitudesEstandarizadas.flatMap((solicitud) =>
      (Array.isArray(solicitud.documentos) ? solicitud.documentos : []).map((doc) => ({
        ...doc,
        solicitud_id: solicitud.id,
        cliente_id: cliente_id
      }))
    );
    const documentosClienteUnicos = deduplicarDocumentosPorId(documentosCliente);

    res.json({
      success: true,
      data: {
        cliente: {
          id: cliente.id,
          nombre: cliente.nombre,
          apellido: cliente.apellido,
          estado: cliente.estado
        },
        solicitudes: solicitudesEstandarizadas,
        documentos: documentosClienteUnicos,
        resumen: {
          total: solicitudesEstandarizadas.length,
          pendientes: solicitudesEstandarizadas.filter(s => s.estado === 'PENDIENTE').length,
          aprobadas: solicitudesEstandarizadas.filter(s => s.estado === 'APROBADO').length,
          rechazadas: solicitudesEstandarizadas.filter(s => s.estado === 'RECHAZADO').length,
          documentos: documentosClienteUnicos.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Error obteniendo solicitudes del cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo solicitudes del cliente'
    });
  }
});

module.exports = router;
