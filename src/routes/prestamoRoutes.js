const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const { Prestamo, Solicitud, Cliente, Cuota, SolicitudDocumento, sequelize } = require('../models');
const { Op } = require('sequelize');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { sendCsv } = require('../utils/exporter');
const {
  buildWeeklyDueDates,
  normalizeToNoon,
  resolveWeeklyFirstDueDate
} = require('../utils/cuotaSchedule');
const {
  applyWeeklyPaymentToQuotas,
  round2
} = require('../utils/weeklyPaymentApplication');
const { buildClienteNombreCompleto } = require('../utils/clienteDisplay');
const { getDocumentStorageState } = require('../utils/documentStorage');
const {
  ensurePrestamoAbonoParcialColumns,
  resolveLoanPaymentCounters
} = require('../utils/prestamoAbonos');

const toMoneyNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(numeric.toFixed(2));
};

const buildFinancialSummaryFromBase = (prestamo = {}) => {
  const montoSolicitado = toMoneyNumber(prestamo.monto_solicitado) || 0;
  const interes = toMoneyNumber(prestamo.interes) || 0;
  const numSemanas = Number(prestamo.num_semanas) || 0;
  const pagado = toMoneyNumber(prestamo.pagado) || 0;

  const totalPagar = round2(montoSolicitado + (montoSolicitado * interes / 100));
  const pagosSemanales = numSemanas > 0 ? round2(totalPagar / numSemanas) : totalPagar;
  const pendiente = Math.max(round2(totalPagar - pagado), 0);

  return {
    totalPagar,
    pagosSemanales,
    pendiente,
    ganancias: round2(totalPagar - montoSolicitado)
  };
};

const normalizeOperationalStatus = (prestamo = {}) => {
  const rawStatus = String(prestamo.status || '').trim().toUpperCase();
  const cuotasRestantes = resolveCuotasRestantes(prestamo);
  const pendiente = Number(prestamo.pendiente || 0);

  if (rawStatus.includes('LE QUEDAN')) return 'EN_MARCHA';
  if (['NO DEBE NADA', 'PAGADO', 'CANCELADO'].includes(rawStatus)) return 'PAGADO';
  if (['ACTIVO', 'EN_PROCESO', 'EN_MARCHA', 'MOROSO'].includes(rawStatus)) return rawStatus;

  if (cuotasRestantes > 0 || pendiente > 0) return 'EN_MARCHA';
  return 'PAGADO';
};

const resolveCuotasRestantes = (prestamo = {}) => {
  // Prioridad de fuentes para evitar inconsistencias por redondeo:
  // 1) status textual "LE QUEDAN X PAGOS"
  const rawStatus = String(prestamo.status || '').toUpperCase();
  const matchStatus = rawStatus.match(/LE\s+QUEDAN\s+(\d+)\s+PAGOS?/);
  if (matchStatus?.[1]) {
    return Math.max(parseInt(matchStatus[1], 10), 0);
  }

  const counters = resolveLoanPaymentCounters(prestamo);
  if (Number.isFinite(counters.cuotasRestantes)) {
    return Math.max(Math.round(counters.cuotasRestantes), 0);
  }

  return 0;
};

const calcularFechaVencimiento = (fechaInicio, numSemanas) => {
  const fecha = new Date(fechaInicio);
  const semanas = parseInt(numSemanas) || 0;
  fecha.setDate(fecha.getDate() + semanas * 7);
  return fecha;
};

const calcularMontos = (montoSolicitado, interes, numSemanas) => {
  const monto = parseFloat(montoSolicitado) || 0;
  const tasa = parseFloat(interes) || 0;
  const semanas = parseInt(numSemanas) || 0;

  const interesTotal = monto * (tasa / 100);
  const totalPagar = monto + interesTotal;
  const ganancias = totalPagar - monto;
  const pagosSemanales = semanas > 0 ? totalPagar / semanas : 0;

  return {
    totalPagar: parseFloat(totalPagar.toFixed(2)),
    ganancias: parseFloat(ganancias.toFixed(2)),
    pagosSemanales: parseFloat(pagosSemanales.toFixed(2))
  };
};

const generarPlanCuotasSemanales = ({
  prestamoId,
  fechaInicio,
  fechaPrimerVencimiento,
  fechaPrimerPago,
  numSemanas,
  montoSolicitado,
  totalPagar
}) => {
  const semanas = parseInt(numSemanas, 10) || 0;
  if (semanas <= 0) return [];

  const principal = parseFloat(montoSolicitado) || 0;
  const total = parseFloat(totalPagar) || 0;
  const interesTotal = parseFloat((total - principal).toFixed(2));

  const montoCuotaBase = parseFloat((total / semanas).toFixed(2));
  const capitalCuotaBase = parseFloat((principal / semanas).toFixed(2));
  const interesCuotaBase = parseFloat((interesTotal / semanas).toFixed(2));

  let acumuladoMonto = 0;
  let acumuladoCapital = 0;
  let acumuladoInteres = 0;
  const cuotas = [];

  const fechasVencimiento = buildWeeklyDueDates({
    numSemanas: semanas,
    fechaInicio,
    fechaPrimerVencimiento,
    fechaPrimerPago
  });

  for (let index = 1; index <= semanas; index += 1) {
    const fechaVencimiento = fechasVencimiento[index - 1] || new Date(fechaInicio);

    const esUltima = index === semanas;
    const montoTotalCuota = esUltima
      ? parseFloat((total - acumuladoMonto).toFixed(2))
      : montoCuotaBase;
    const montoCapitalCuota = esUltima
      ? parseFloat((principal - acumuladoCapital).toFixed(2))
      : capitalCuotaBase;
    const montoInteresCuota = esUltima
      ? parseFloat((interesTotal - acumuladoInteres).toFixed(2))
      : interesCuotaBase;

    acumuladoMonto = parseFloat((acumuladoMonto + montoTotalCuota).toFixed(2));
    acumuladoCapital = parseFloat((acumuladoCapital + montoCapitalCuota).toFixed(2));
    acumuladoInteres = parseFloat((acumuladoInteres + montoInteresCuota).toFixed(2));

    cuotas.push({
      prestamo_id: prestamoId,
      fecha_vencimiento: fechaVencimiento,
      monto_capital: montoCapitalCuota,
      monto_interes: montoInteresCuota,
      monto_total: montoTotalCuota,
      estado: 'PENDIENTE',
      monto_pagado: 0,
      observaciones: `Cuota ${index} de ${semanas}`
    });
  }

  return cuotas;
};

const DOCUMENT_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'solicitudes');

const asegurarDirectorio = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

asegurarDirectorio(DOCUMENT_UPLOAD_DIR);

const contratoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, DOCUMENT_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.pdf';
    const baseName = path
      .basename(file.originalname || 'contrato_credito', ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50);
    cb(null, `${timestamp}-${random}-${baseName}${ext}`);
  }
});

const contratoUpload = multer({
  storage: contratoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || path.extname(file.originalname || '').toLowerCase() === '.pdf';
    if (!isPdf) return cb(new Error('El contrato debe estar en formato PDF.'), false);
    return cb(null, true);
  }
});

const uploadContratoCredito = (req, res, next) => {
  contratoUpload.fields([
    { name: 'contrato_credito', maxCount: 1 },
    { name: 'documentos', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      const rawMessage = String(err.message || '').toLowerCase();
      if (rawMessage.includes('file too large')) {
        return res.status(400).json({
          success: false,
          message: 'El contrato supera el tamaño máximo permitido.'
        });
      }

      if (rawMessage.includes('pdf')) {
        return res.status(400).json({
          success: false,
          message: 'El contrato debe estar en formato PDF.'
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Error validando archivo de contrato'
      });
    }

    return next();
  });
};

const obtenerArchivoContratoDesdeRequest = (req) => {
  const files = req.files || {};
  const fromContrato = Array.isArray(files.contrato_credito) ? files.contrato_credito[0] : null;
  if (fromContrato) return fromContrato;
  const fromDocumentos = Array.isArray(files.documentos) ? files.documentos[0] : null;
  return fromDocumentos || null;
};

const eliminarArchivoSubido = async (archivo) => {
  if (!archivo?.path) return;
  await fs.promises.unlink(archivo.path).catch(() => null);
};

const construirUrlDocumento = (req, documentoId, disposition = 'attachment') =>
  `${req.protocol}://${req.get('host')}/api/documentos/${documentoId}/download?disposition=${disposition}`;

const construirUrlArchivoRelativo = (req, rutaRelativa = '') => {
  if (!rutaRelativa) return null;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const rutaNormalizada = String(rutaRelativa).replace(/\\/g, '/').replace(/^\/+/, '');
  return `${baseUrl}/${rutaNormalizada}`;
};

const resolveContratoPrestamoAvailability = (rawPrestamo = {}, contratoDoc = null) => {
  const contratoDocPath = contratoDoc?.ruta || null;
  const prestamoContratoPath = rawPrestamo?.contrato || null;
  const candidatePath = contratoDocPath || prestamoContratoPath;
  const availability = getDocumentStorageState(candidatePath);
  const rutaDisponible = availability.exists ? availability.relativePath : null;

  return {
    existe: Boolean(availability.exists),
    storage_path: rutaDisponible,
    storage_key: rutaDisponible
  };
};

let solicitudDocumentoSchemaChecked = false;
let solicitudDocumentoSchemaReady = false;

const ensureSolicitudDocumentoSchema = async () => {
  if (solicitudDocumentoSchemaChecked) {
    return solicitudDocumentoSchemaReady;
  }

  await sequelize.query(`
    ALTER TABLE public.solicitud_documentos
    ADD COLUMN IF NOT EXISTS tipo_documento character varying(30)
  `);

  await sequelize.query(`
    ALTER TABLE public.solicitud_documentos
    ADD COLUMN IF NOT EXISTS prestamo_id uuid
  `);

  solicitudDocumentoSchemaChecked = true;
  solicitudDocumentoSchemaReady = true;
  return true;
};

let prestamoContratoColumnChecked = false;
let prestamoContratoColumnReady = false;

const ensurePrestamoContratoColumn = async () => {
  if (prestamoContratoColumnChecked) {
    return prestamoContratoColumnReady;
  }

  await sequelize.query(`
    ALTER TABLE public.prestamos
    ADD COLUMN IF NOT EXISTS contrato character varying(500)
  `);

  prestamoContratoColumnChecked = true;
  prestamoContratoColumnReady = true;
  return true;
};

let clienteReferidosColumnsChecked = false;
let clienteReferidosColumnsReady = false;

const ensureClienteReferidosColumns = async () => {
  if (clienteReferidosColumnsChecked) {
    return clienteReferidosColumnsReady;
  }

  await sequelize.query(`
    ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS descuentos_referido_disponibles integer NOT NULL DEFAULT 0
  `);

  await sequelize.query(`
    ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS descuentos_referido_aplicados integer NOT NULL DEFAULT 0
  `);

  clienteReferidosColumnsChecked = true;
  clienteReferidosColumnsReady = true;
  return true;
};

let prestamoReminderModeColumnsChecked = false;
let prestamoReminderModeColumnsReady = false;
const REMINDER_MODES = new Set(['AUTO', 'MANUAL', 'PAUSADO']);

const ensurePrestamoReminderModeColumns = async () => {
  if (prestamoReminderModeColumnsChecked) {
    return prestamoReminderModeColumnsReady;
  }

  await sequelize.query(`
    ALTER TABLE public.prestamos
    ADD COLUMN IF NOT EXISTS recordatorio_whatsapp_modo character varying(20) NOT NULL DEFAULT 'AUTO'
  `);
  await sequelize.query(`
    ALTER TABLE public.prestamos
    ADD COLUMN IF NOT EXISTS recordatorio_whatsapp_actualizado_en timestamp without time zone NULL
  `);
  await sequelize.query(`
    ALTER TABLE public.prestamos
    ADD COLUMN IF NOT EXISTS recordatorio_whatsapp_actualizado_por uuid NULL
  `);

  prestamoReminderModeColumnsChecked = true;
  prestamoReminderModeColumnsReady = true;
  return true;
};

let cuotaFeeColumnsChecked = false;
let cuotaFeeColumnsReady = false;

const ensureCuotaFeeColumns = async () => {
  if (cuotaFeeColumnsChecked) {
    return cuotaFeeColumnsReady;
  }

  await sequelize.query(`
    ALTER TABLE public.cuotas
    ADD COLUMN IF NOT EXISTS monto_fee_acumulado numeric(15,2) NOT NULL DEFAULT 0
  `);
  await sequelize.query(`
    ALTER TABLE public.cuotas
    ADD COLUMN IF NOT EXISTS monto_penalizacion_acumulada numeric(15,2) NOT NULL DEFAULT 0
  `);
  await sequelize.query(`
    ALTER TABLE public.cuotas
    ADD COLUMN IF NOT EXISTS motivo_fee text NULL
  `);

  cuotaFeeColumnsChecked = true;
  cuotaFeeColumnsReady = true;
  return true;
};

router.use(async (_req, res, next) => {
  try {
    await ensurePrestamoContratoColumn();
    await ensurePrestamoReminderModeColumns();
    return next();
  } catch (error) {
    console.error('Error asegurando columnas de préstamos:', error);
    return res.status(500).json({
      success: false,
      message: 'Error inicializando configuración de préstamos'
    });
  }
});

// GET /api/prestamos - Obtener todos los préstamos (paginado y filtrado)
router.get('/', authenticateToken, requirePermission('prestamos.view'), async (req, res) => {
  try {
    await ensureSolicitudDocumentoSchema();
    await ensurePrestamoContratoColumn();
    await ensurePrestamoReminderModeColumns();
    const {
      page = 1,
      limit = 20,
      prestamo_id,
      status,
      search,
      cliente_id,
      format,
      fecha_desde,
      fecha_hasta
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (prestamo_id) {
      where.id = prestamo_id;
    }
    if (status) {
      const statusNormalizado = String(status).trim().toUpperCase();
      if (statusNormalizado !== 'TODOS') {
        if (statusNormalizado === 'ACTIVO') {
          where[Op.or] = [
            { status: { [Op.in]: ['ACTIVO', 'EN_PROCESO', 'EN_MARCHA', 'MOROSO'] } },
            { status: { [Op.iLike]: 'LE QUEDAN %PAGOS POR PAGAR' } },
            { pagos_pendientes: { [Op.gt]: 0 } },
            { pendiente: { [Op.gt]: 0 } }
          ];
        } else if (statusNormalizado === 'PAGADO') {
          where[Op.or] = [
            { status: { [Op.in]: ['PAGADO', 'NO DEBE NADA', 'CANCELADO'] } },
            {
              [Op.and]: [
                { pagos_pendientes: { [Op.lte]: 0 } },
                { pendiente: { [Op.lte]: 0 } }
              ]
            }
          ];
        } else {
          where.status = status;
        }
      }
    }

    if (search && String(search).trim() !== '') {
      const term = String(search).trim().replace(/\s+/g, ' ').toUpperCase();
      const termSql = term.replace(/'/g, "''");

      const searchCondition = sequelize.literal(`
        (
          regexp_replace(upper("Prestamo"."nombre_completo"), '\\s+', ' ', 'g') LIKE '%${termSql}%'
          OR EXISTS (
            SELECT 1
            FROM solicitudes s
            INNER JOIN clientes c ON c.id = s.cliente_id
            WHERE s.id = "Prestamo"."solicitud_id"
              AND (
                upper(c.nombre) LIKE '%${termSql}%'
                OR upper(c.apellido) LIKE '%${termSql}%'
              )
          )
        )
      `);

      const andConditions = Array.isArray(where[Op.and]) ? where[Op.and] : [];
      where[Op.and] = [...andConditions, searchCondition];
    }

    if (fecha_desde || fecha_hasta) {
      where.fecha_inicio = {};
      if (fecha_desde) {
        where.fecha_inicio[Op.gte] = new Date(fecha_desde);
      }
      if (fecha_hasta) {
        where.fecha_inicio[Op.lte] = new Date(fecha_hasta);
      }
    }

    const include = [
      { 
        model: Solicitud, 
        as: 'solicitud',
        include: [
          { model: Cliente, as: 'cliente' }
        ]
      }
    ];

    if (cliente_id) {
      include[0].where = { cliente_id };
    }

    const queryOptions = {
      where,
      include,
      order: [['fecha_inicio', 'DESC']],
      subQuery: false
    };

    if (format !== 'csv') {
      queryOptions.limit = parseInt(limit);
      queryOptions.offset = offset;
    }

    queryOptions.distinct = true;
    queryOptions.include = [
      ...queryOptions.include,
      {
        model: Cuota,
        as: 'cuotas',
        attributes: ['id', 'monto_total', 'monto_pagado', 'estado', 'fecha_vencimiento'],
        required: false
      }
    ];

    const { count, rows: prestamos } = await Prestamo.findAndCountAll(queryOptions);
    const solicitudIds = prestamos
      .map((prestamo) => prestamo?.solicitud?.id || prestamo?.solicitud_id)
      .filter(Boolean);

    const contratos = solicitudIds.length
      ? await SolicitudDocumento.findAll({
          where: {
            solicitud_id: { [Op.in]: solicitudIds },
            tipo_documento: 'CONTRATO_CREDITO'
          },
          order: [['creado_en', 'DESC']]
        })
      : [];

    const contratoBySolicitud = new Map();
    contratos.forEach((doc) => {
      if (!contratoBySolicitud.has(doc.solicitud_id)) {
        contratoBySolicitud.set(doc.solicitud_id, doc);
      }
    });

    const prestamosConClienteId = prestamos.map((prestamo) => {
      const raw = prestamo.toJSON();
      const solicitudId = raw?.solicitud?.id || raw?.solicitud_id;
      const contratoDoc = contratoBySolicitud.get(solicitudId);
      const cuotasRestantes = resolveCuotasRestantes(raw);
      const nombreCompletoCliente = buildClienteNombreCompleto(raw?.solicitud?.cliente || {});
      const contratoAvailability = resolveContratoPrestamoAvailability(raw, contratoDoc);
      const contratoUrl = contratoAvailability.existe
        ? (contratoDoc
            ? construirUrlDocumento(req, contratoDoc.id, 'inline')
            : construirUrlArchivoRelativo(req, contratoAvailability.storage_path || raw?.contrato))
        : null;
      const financialSummary = buildFinancialSummaryFromBase(raw);
      const counters = resolveLoanPaymentCounters(raw);
      const contratoActivo = contratoAvailability.existe && Number(counters.saldoPendiente || 0) > 0;

      return {
        ...raw,
        cliente_id: raw?.solicitud?.cliente_id || null,
        nombre_completo: nombreCompletoCliente || raw.nombre_completo || null,
        nombre_completo_registro: raw.nombre_completo || null,
        cliente_nombre: nombreCompletoCliente || raw.nombre_completo || null,
        total_pagar_registro: raw.total_pagar || null,
        pagos_semanales_registro: raw.pagos_semanales || null,
        pendiente_registro: raw.pendiente || null,
        ganancias_registro: raw.ganancias || null,
        total_pagar_bruto: financialSummary.totalPagar,
        pagos_semanales_bruto: financialSummary.pagosSemanales,
        ganancias_bruto: financialSummary.ganancias,
        total_pagar: raw.total_pagar,
        pagos_semanales: raw.pagos_semanales,
        ganancias: raw.ganancias,
        pendiente: counters.saldoPendiente,
        saldo_pendiente: counters.saldoPendiente,
        monto_pendiente: counters.saldoPendiente,
        pagos_hechos: counters.pagosHechos,
        cuotas_restantes: counters.cuotasRestantes,
        pagos_pendientes: counters.cuotasRestantes,
        abono_parcial_acumulado: raw.abono_parcial_acumulado || 0,
        contrato_disponible: contratoAvailability.existe,
        contrato_activo: contratoActivo,
        contrato_storage_path: contratoAvailability.storage_path,
        contrato_credito_id: contratoAvailability.existe ? (contratoDoc?.id || null) : null,
        status_normalizado: normalizeOperationalStatus(raw),
        es_activo_operativo: normalizeOperationalStatus(raw) !== 'PAGADO',
        contrato_url: contratoUrl
      };
    });

    if (format === 'csv') {
      const csvRows = prestamosConClienteId.map((item) => ({
        id: item.id,
        cliente_id: item.cliente_id,
        nombre_completo: item.nombre_completo,
        nombre_completo_registro: item.nombre_completo_registro,
        fecha_inicio: item.fecha_inicio,
        monto_solicitado: item.monto_solicitado,
        interes: item.interes,
        num_semanas: item.num_semanas,
        total_pagar: item.total_pagar,
        total_pagar_bruto: item.total_pagar_bruto,
        total_pagar_registro: item.total_pagar_registro,
        pagos_semanales: item.pagos_semanales,
        pagos_semanales_bruto: item.pagos_semanales_bruto,
        pagos_semanales_registro: item.pagos_semanales_registro,
        pagos_hechos: item.pagos_hechos,
        pagos_pendientes: item.pagos_pendientes,
        abono_parcial_acumulado: item.abono_parcial_acumulado,
        pendiente: item.pendiente,
        pendiente_registro: item.pendiente_registro,
        saldo_pendiente: item.saldo_pendiente,
        monto_pendiente: item.monto_pendiente,
        pagos_hechos: item.pagos_hechos,
        contrato_activo: item.contrato_activo,
        status: item.status,
        fecha_vencimiento: item.fecha_vencimiento,
        contrato: item.contrato
      }));

      return sendCsv(res, {
        filename: `prestamos_${Date.now()}.csv`,
        headers: [
          { key: 'id', label: 'id' },
          { key: 'cliente_id', label: 'cliente_id' },
          { key: 'nombre_completo', label: 'nombre_completo' },
          { key: 'nombre_completo_registro', label: 'nombre_completo_registro' },
          { key: 'fecha_inicio', label: 'fecha_inicio' },
          { key: 'monto_solicitado', label: 'monto_solicitado' },
          { key: 'interes', label: 'interes' },
          { key: 'num_semanas', label: 'num_semanas' },
          { key: 'total_pagar', label: 'total_pagar' },
          { key: 'total_pagar_bruto', label: 'total_pagar_bruto' },
          { key: 'total_pagar_registro', label: 'total_pagar_registro' },
          { key: 'pagos_semanales', label: 'pagos_semanales' },
          { key: 'pagos_semanales_bruto', label: 'pagos_semanales_bruto' },
          { key: 'pagos_semanales_registro', label: 'pagos_semanales_registro' },
          { key: 'pagos_hechos', label: 'pagos_hechos' },
          { key: 'pagos_pendientes', label: 'pagos_pendientes' },
          { key: 'abono_parcial_acumulado', label: 'abono_parcial_acumulado' },
          { key: 'pendiente', label: 'pendiente' },
          { key: 'pendiente_registro', label: 'pendiente_registro' },
          { key: 'saldo_pendiente', label: 'saldo_pendiente' },
          { key: 'monto_pendiente', label: 'monto_pendiente' },
          { key: 'contrato_activo', label: 'contrato_activo' },
          { key: 'status', label: 'status' },
          { key: 'fecha_vencimiento', label: 'fecha_vencimiento' },
          { key: 'contrato', label: 'contrato' }
        ],
        rows: csvRows
      });
    }

    res.json({
      success: true,
      data: prestamosConClienteId,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error obteniendo préstamos:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo préstamos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/prestamos - Crear préstamo manualmente
router.post('/', authenticateToken, requirePermission('prestamos.create'), async (req, res) => {
  try {
    const { 
      solicitud_id, 
      monto_solicitado, 
      interes,
      fecha_inicio 
    } = req.body;

    if (!solicitud_id || !monto_solicitado) {
      return res.status(400).json({
        success: false,
        message: 'solicitud_id y monto_solicitado son requeridos'
      });
    }

    const prestamo = await Prestamo.create({
      solicitud_id,
      fecha_inicio: fecha_inicio || new Date(),
      monto_solicitado: parseFloat(monto_solicitado),
      interes: interes || 0,
      total_pagar: parseFloat(monto_solicitado) + (parseFloat(monto_solicitado) * (interes || 0) / 100),
      pendiente: parseFloat(monto_solicitado) + (parseFloat(monto_solicitado) * (interes || 0) / 100),
      status: 'ACTIVO'
    });

    res.status(201).json({
      success: true,
      message: 'Préstamo creado exitosamente',
      data: prestamo
    });
  } catch (error) {
    console.error('Error creando préstamo:', error);
    res.status(500).json({
      success: false,
      message: 'Error creando préstamo'
    });
  }
});

// POST /api/prestamos/solicitud/:solicitudId - Crear préstamo desde solicitud aprobada
router.post(
  '/solicitud/:solicitudId',
  authenticateToken,
  requirePermission('solicitudes.approve'),
  uploadContratoCredito,
  async (req, res) => {
  try {
    const { solicitudId } = req.params;
    const {
      fecha_inicio,
      fecha_primer_pago,
      fecha_primer_vencimiento,
      num_dias = 0
    } = req.body;
    const contratoArchivo = obtenerArchivoContratoDesdeRequest(req);
    const contratoRutaRelativa = path.relative(path.join(__dirname, '..', '..'), contratoArchivo?.path || '');

    if (!contratoArchivo) {
      return res.status(400).json({
        success: false,
        message: 'Debe cargar el contrato de aceptación del crédito en PDF.'
      });
    }

    const isPdfContrato = contratoArchivo.mimetype === 'application/pdf' || path.extname(contratoArchivo.originalname || '').toLowerCase() === '.pdf';
    if (!isPdfContrato) {
      await eliminarArchivoSubido(contratoArchivo);
      return res.status(400).json({
        success: false,
        message: 'El contrato debe estar en formato PDF.'
      });
    }

    if ((contratoArchivo.size || 0) > 10 * 1024 * 1024) {
      await eliminarArchivoSubido(contratoArchivo);
      return res.status(400).json({
        success: false,
        message: 'El contrato supera el tamaño máximo permitido.'
      });
    }

    const resultado = await sequelize.transaction(async (transaction) => {
      await ensureSolicitudDocumentoSchema();
      await ensurePrestamoContratoColumn();
      await ensureClienteReferidosColumns();
      const solicitud = await Solicitud.findByPk(solicitudId, {
        transaction
      });

      if (!solicitud) {
        return { status: 404, body: { success: false, message: 'Solicitud no encontrada' } };
      }

      const cliente = await Cliente.findByPk(solicitud.cliente_id, { transaction });
      if (!cliente) {
        return { status: 404, body: { success: false, message: 'Cliente no encontrado para la solicitud' } };
      }

      if (solicitud.estado !== 'PENDIENTE') {
        return { status: 400, body: { success: false, message: 'La solicitud debe estar en estado PENDIENTE' } };
      }

      const prestamoExistente = await Prestamo.findOne({
        where: { solicitud_id: solicitud.id },
        transaction
      });

      if (prestamoExistente) {
        return { status: 400, body: { success: false, message: 'La solicitud ya tiene un préstamo asociado' } };
      }

      const fechaAprobacion = new Date();
      const fechaInicio = normalizeToNoon(fecha_inicio) || normalizeToNoon(new Date());
      const montoSolicitado = parseFloat(solicitud.monto_solicitado) || 0;
      const tasaInteres = parseFloat(solicitud.tasa_variable || 0) * 100;
      const modalidad = solicitud.modalidad || 'SEMANAL';
      const semanas = parseInt(solicitud.plazo_semanas, 10);

      if (!Number.isFinite(semanas) || semanas <= 0) {
        return {
          status: 400,
          body: { success: false, message: 'La solicitud no tiene un plazo_semanas válido' }
        };
      }

      const { totalPagar, ganancias, pagosSemanales } = calcularMontos(
        montoSolicitado,
        tasaInteres,
        semanas
      );

      const esSemanal = String(modalidad || '').toUpperCase() === 'SEMANAL';
      const fechaPrimerVencimientoSemanal = esSemanal
        ? resolveWeeklyFirstDueDate({
            fechaInicio,
            fechaAprobacion,
            fechaPrimerPago: fecha_primer_pago,
            fechaPrimerVencimiento: fecha_primer_vencimiento
          })
        : null;
      const fechaVencimiento = esSemanal
        ? calcularFechaVencimiento(fechaPrimerVencimientoSemanal, semanas - 1)
        : calcularFechaVencimiento(fechaInicio, semanas);

      await solicitud.update({
        estado: 'APROBADO',
        analista_id: req.user.id,
        fecha_aprobacion: fechaAprobacion
      }, { transaction });

      const prestamo = await Prestamo.create({
        solicitud_id: solicitud.id,
        fecha_inicio: fechaInicio,
        fecha_aprobacion: fechaAprobacion,
        mes: fechaInicio.toLocaleString('es-ES', { month: 'long' }),
        anio: fechaInicio.getFullYear().toString(),
        nombre_completo: `${cliente.nombre} ${cliente.apellido}`,
        monto_solicitado: montoSolicitado,
        interes: tasaInteres,
        modalidad,
        num_semanas: semanas,
        num_dias: parseInt(num_dias, 10) || 0,
        fecha_vencimiento: fechaVencimiento,
        total_pagar: totalPagar,
        ganancias,
        pagos_semanales: pagosSemanales,
        pagos_hechos: 0,
        pagos_pendientes: semanas,
        pagado: 0,
        pendiente: totalPagar,
        status: 'ACTIVO',
        ganancia_diaria: 0,
        reserva: 0,
        refinanciado: 0,
        perdida: 0,
        caso_especial: null,
        oferta: 0,
        proyeccion_mes: null,
        anio_vencimiento: null,
        contrato: contratoRutaRelativa || null
      }, { transaction });

      const planCuotas = generarPlanCuotasSemanales({
        prestamoId: prestamo.id,
        fechaInicio,
        fechaPrimerVencimiento: fechaPrimerVencimientoSemanal,
        fechaPrimerPago: fecha_primer_pago,
        numSemanas: semanas,
        montoSolicitado,
        totalPagar
      });

      const cuotasExistentes = await Cuota.count({
        where: { prestamo_id: prestamo.id },
        transaction
      });

      let cuotasGeneradas = 0;
      if (cuotasExistentes === 0 && planCuotas.length > 0) {
        await Cuota.bulkCreate(planCuotas, { transaction });
        cuotasGeneradas = planCuotas.length;
      }

      let descuentoReferidoAplicado = 0;
      const montoReferidoCliente = parseFloat(cliente.monto_referido || 0);
      const descuentosDisponibles = parseInt(cliente.descuentos_referido_disponibles, 10) || 0;
      if (montoReferidoCliente > 0 && descuentosDisponibles > 0) {
        descuentoReferidoAplicado = parseFloat(Math.min(montoReferidoCliente, totalPagar).toFixed(2));

        const ultimaCuota = await Cuota.findOne({
          where: { prestamo_id: prestamo.id },
          order: [['fecha_vencimiento', 'DESC']],
          transaction
        });

        if (ultimaCuota) {
          const montoUltimaCuota = round2(ultimaCuota.monto_total || 0);
          const nuevoMontoUltimaCuota = round2(Math.max(montoUltimaCuota - descuentoReferidoAplicado, 0));
          const interesUltimaCuota = round2(ultimaCuota.monto_interes || 0);
          const interesReducido = Math.min(interesUltimaCuota, descuentoReferidoAplicado);
          const capitalReducido = round2(descuentoReferidoAplicado - interesReducido);

          ultimaCuota.monto_interes = round2(Math.max(interesUltimaCuota - interesReducido, 0));
          ultimaCuota.monto_capital = round2(Math.max(round2(ultimaCuota.monto_capital || 0) - capitalReducido, 0));
          ultimaCuota.monto_total = round2(ultimaCuota.monto_capital + ultimaCuota.monto_interes);
          ultimaCuota.observaciones = ultimaCuota.observaciones
            ? `${ultimaCuota.observaciones}\nDescuento referido aplicado: -${descuentoReferidoAplicado.toFixed(2)} USD`
            : `Descuento referido aplicado: -${descuentoReferidoAplicado.toFixed(2)} USD`;
          await ultimaCuota.save({ transaction });
        }

        await cliente.update({
          descuentos_referido_disponibles: Math.max(descuentosDisponibles - 1, 0),
          descuentos_referido_aplicados: (parseInt(cliente.descuentos_referido_aplicados, 10) || 0) + 1
        }, { transaction });
      }

      const totalPagarNeto = round2(totalPagar - descuentoReferidoAplicado);
      const gananciasNetas = round2(ganancias - descuentoReferidoAplicado);

      await prestamo.update({
        total_pagar: totalPagarNeto,
        ganancias: gananciasNetas,
        pendiente: totalPagarNeto
      }, { transaction });

      const contrato = await SolicitudDocumento.create({
        solicitud_id: solicitud.id,
        prestamo_id: prestamo.id,
        nombre_original: contratoArchivo.originalname,
        nombre_archivo: contratoArchivo.filename,
        mime_type: contratoArchivo.mimetype || 'application/pdf',
        size_bytes: contratoArchivo.size || 0,
        tipo_documento: 'CONTRATO_CREDITO',
        ruta: path.relative(path.join(__dirname, '..', '..'), contratoArchivo.path)
      }, { transaction });

      const contratoAvailability = getDocumentStorageState(contrato.ruta || prestamo.contrato);

      return {
        status: 201,
        body: {
          success: true,
          message: '✅ Solicitud aprobada y contrato registrado',
          data: {
            prestamo,
            cuotas_generadas: cuotasGeneradas,
            descuento_referido_aplicado: descuentoReferidoAplicado,
            total_pagar_bruto: totalPagar,
            total_pagar_neto: totalPagarNeto,
            pagos_semanales_bruto: pagosSemanales,
            contrato_credito_id: contrato.id,
            contrato: {
              id: contrato.id,
              nombre: contrato.nombre_original,
              tipo: 'CONTRATO_CREDITO',
              storage_path: contratoAvailability.exists ? contratoAvailability.relativePath : null,
              contrato_disponible: contratoAvailability.exists,
              url: contratoAvailability.exists ? construirUrlArchivoRelativo(req, contratoAvailability.relativePath) : null,
              url_descarga: construirUrlDocumento(req, contrato.id, 'attachment')
            }
          }
        }
      };
    });

    if (resultado.status >= 400) {
      await eliminarArchivoSubido(contratoArchivo);
    }

    return res.status(resultado.status).json(resultado.body);
  } catch (error) {
    console.error('Error creando préstamo desde solicitud:', error);
    await eliminarArchivoSubido(obtenerArchivoContratoDesdeRequest(req));
    return res.status(500).json({
      success: false,
      message: 'Error creando préstamo desde solicitud'
    });
  }
  }
);

// GET /api/prestamos/:id/recordatorios/whatsapp - Obtener modo de recordatorio WhatsApp
router.get('/:id/recordatorios/whatsapp', authenticateToken, requirePermission('prestamos.view'), async (req, res) => {
  try {
    await ensurePrestamoReminderModeColumns();
    const prestamo = await Prestamo.findByPk(req.params.id, {
      attributes: ['id', 'recordatorio_whatsapp_modo']
    });

    if (!prestamo) {
      return res.status(404).json({
        success: false,
        message: 'Préstamo no encontrado',
        code: 'LOAN_NOT_FOUND'
      });
    }

    return res.json({
      success: true,
      data: {
        prestamo_id: prestamo.id,
        modo: String(prestamo.recordatorio_whatsapp_modo || 'AUTO').toUpperCase()
      }
    });
  } catch (error) {
    console.error('Error obteniendo modo de recordatorio WhatsApp:', error);
    return res.status(500).json({
      success: false,
      message: 'Error obteniendo modo de recordatorio WhatsApp'
    });
  }
});

// PUT /api/prestamos/:id/recordatorios/whatsapp - Actualizar modo de recordatorio WhatsApp
router.put('/:id/recordatorios/whatsapp', authenticateToken, requirePermission('notifications.whatsapp.manage'), async (req, res) => {
  try {
    await ensurePrestamoReminderModeColumns();
    const prestamo = await Prestamo.findByPk(req.params.id);

    if (!prestamo) {
      return res.status(404).json({
        success: false,
        message: 'Préstamo no encontrado',
        code: 'LOAN_NOT_FOUND'
      });
    }

    const modoRaw = String(req.body?.modo || '').trim().toUpperCase();
    if (!REMINDER_MODES.has(modoRaw)) {
      return res.status(400).json({
        success: false,
        message: 'Modo de recordatorio inválido',
        code: 'INVALID_REMINDER_MODE'
      });
    }

    await prestamo.update({
      recordatorio_whatsapp_modo: modoRaw,
      recordatorio_whatsapp_actualizado_en: new Date(),
      recordatorio_whatsapp_actualizado_por: req.user?.id || null
    });

    return res.json({
      success: true,
      message: 'Modo de recordatorio actualizado correctamente',
      data: {
        prestamo_id: prestamo.id,
        modo: modoRaw
      }
    });
  } catch (error) {
    console.error('Error actualizando modo de recordatorio WhatsApp:', error);
    return res.status(500).json({
      success: false,
      message: 'Error actualizando modo de recordatorio WhatsApp'
    });
  }
});

// POST /api/prestamos/:id/pago-semanal - Registrar pago de cuota semanal desde préstamo
router.post('/:id/pago-semanal', authenticateToken, requirePermission('prestamos.pay'), async (req, res) => {
  try {
    const { id } = req.params;
    const { monto_pago, monto_penalizacion = 0, monto_fee = 0, motivo_fee = null } = req.body;

    const buildError = (status, message, code = 'PAYMENT_RULE_VIOLATION') => ({
      status,
      body: {
        success: false,
        message,
        code
      }
    });

    const resultado = await sequelize.transaction(async (transaction) => {
      await ensureCuotaFeeColumns();
      await ensurePrestamoAbonoParcialColumns(sequelize);
      const prestamo = await Prestamo.findByPk(id, {
        include: [
          {
            model: Solicitud,
            as: 'solicitud',
            include: [{ model: Cliente, as: 'cliente' }]
          }
        ],
        transaction
      });
      if (!prestamo) {
        return buildError(404, 'Préstamo no encontrado', 'PRESTAMO_NOT_FOUND');
      }

      const cuotasOrdenadas = await Cuota.findAll({
        where: {
          prestamo_id: id
        },
        order: [['fecha_vencimiento', 'ASC']],
        transaction
      });

      const cuotasPendientes = cuotasOrdenadas.filter((item) => {
        const saldo = parseFloat(item.monto_total || 0) - parseFloat(item.monto_pagado || 0);
        return saldo > 0;
      });

      const cuota = cuotasPendientes[0];
      if (!cuota) {
        const loanStatus = String(prestamo.status || '').toUpperCase();
        if (loanStatus === 'PAGADO') {
          return buildError(400, 'Este préstamo ya se encuentra pagado.', 'LOAN_ALREADY_PAID');
        }
        return buildError(400, 'No hay cuotas pendientes para este préstamo.', 'NO_PENDING_INSTALLMENTS');
      }

      const montoPagoRecibido = parseFloat(monto_pago);
      const montoPenalizacion = parseFloat(monto_penalizacion) || 0;
      const montoFee = parseFloat(monto_fee) || 0;
      const motivoFeeNormalizado = motivo_fee ? String(motivo_fee).trim().slice(0, 255) : null;

      if (!monto_pago || isNaN(montoPagoRecibido)) {
        return buildError(400, 'El monto ingresado no coincide con las reglas de pago configuradas.', 'PAYMENT_RULE_VIOLATION');
      }

      if (montoPagoRecibido <= 0) {
        return buildError(400, 'El monto ingresado no coincide con las reglas de pago configuradas.', 'PAYMENT_RULE_VIOLATION');
      }

      if (isNaN(montoPenalizacion) || montoPenalizacion < 0) {
        return buildError(400, 'El monto ingresado no coincide con las reglas de pago configuradas.', 'INVALID_PENALTY_AMOUNT');
      }
      if (isNaN(montoFee) || montoFee < 0) {
        return buildError(400, 'El monto ingresado no coincide con las reglas de pago configuradas.', 'INVALID_FEE_AMOUNT');
      }

      const cuotaBaseOriginal = parseFloat(cuota.monto_total) || 0;
      const ahora = new Date();
      const resultadoAplicacion = applyWeeklyPaymentToQuotas({
        cuotas: cuotasPendientes.map((item) => item.toJSON()),
        montoPagoRecibido,
        montoPenalizacion,
        montoFee,
        motivoFee: motivoFeeNormalizado,
        now: ahora
      });

      const cuotasAjustadas = resultadoAplicacion.cuotasAjustadas;
      const cuotasPorId = new Map(cuotasPendientes.map((item) => [item.id, item]));
      for (const cuotaPlan of resultadoAplicacion.cuotasActualizadas) {
        const cuotaDb = cuotasPorId.get(cuotaPlan.id);
        if (!cuotaDb) continue;

        cuotaDb.monto_total = cuotaPlan.monto_total;
        cuotaDb.monto_pagado = cuotaPlan.monto_pagado;
        cuotaDb.estado = cuotaPlan.estado;
        cuotaDb.fecha_pago = cuotaPlan.fecha_pago;
        cuotaDb.observaciones = cuotaPlan.observaciones;
        cuotaDb.monto_penalizacion_acumulada = cuotaPlan.monto_penalizacion_acumulada;
        cuotaDb.monto_fee_acumulado = cuotaPlan.monto_fee_acumulado;
        cuotaDb.motivo_fee = cuotaPlan.motivo_fee;
        await cuotaDb.save({ transaction });
      }

      const cuotasActualizadas = await Cuota.findAll({
        where: { prestamo_id: id },
        order: [['fecha_vencimiento', 'ASC']],
        transaction
      });

      const metrics = cuotasActualizadas.reduce((acc, item) => {
        const total = parseFloat(item.monto_total || 0);
        const pagado = parseFloat(item.monto_pagado || 0);
        const saldo = Math.max(parseFloat((total - pagado).toFixed(2)), 0);
        const fechaVto = new Date(item.fecha_vencimiento);
        fechaVto.setHours(0, 0, 0, 0);

        acc.pagadoTotal += Math.min(pagado, total);
        acc.pendienteTotal += saldo;
        if (saldo > 0) {
          acc.cuotasConSaldo += 1;
          if (fechaVto < hoy) acc.hayMora = true;
        }
        return acc;
      }, {
        pagadoTotal: 0,
        pendienteTotal: 0,
        cuotasConSaldo: 0,
        hayMora: false
      });

      const pagadoTotal = resultadoAplicacion.pagadoTotal;
      const pendienteTotal = resultadoAplicacion.saldoPendienteTotal;
      const pagosPendientes = resultadoAplicacion.cuotasRestantes;
      const pagosHechos = resultadoAplicacion.pagosHechos;
      const prestamoPagado = resultadoAplicacion.prestamoPagado;
      let estadoPrestamo = 'EN_PROCESO';
      if (prestamoPagado) {
        estadoPrestamo = 'PAGADO';
      } else if (metrics.hayMora) {
        estadoPrestamo = 'MOROSO';
      } else if (pagadoTotal > 0) {
        estadoPrestamo = 'EN_MARCHA';
      }

      await prestamo.update({
        pagos_hechos: pagosHechos,
        pagos_pendientes: pagosPendientes,
        abono_parcial_acumulado: resultadoAplicacion.abonoParcialAcumulado,
        pagado: pagadoTotal,
        pendiente: pendienteTotal,
        status: estadoPrestamo,
        estado: estadoPrestamo
      }, { transaction });

      const clienteNombre = prestamo?.solicitud?.cliente
        ? `${prestamo.solicitud.cliente.nombre} ${prestamo.solicitud.cliente.apellido}`
        : prestamo.nombre_completo || null;

      const codeByType = {
        COMPLETO: 'PAYMENT_APPLIED',
        PARCIAL: 'PARTIAL_PAYMENT_APPLIED',
        ADELANTADO: 'ADVANCE_PAYMENT_APPLIED'
      };

      return {
        status: 200,
        body: {
          success: true,
          message: 'Pago registrado correctamente',
          data: {
            prestamo_id: id,
            estado_prestamo: estadoPrestamo,
            cuota_base: cuotaBaseOriginal,
            monto_aplicado: montoPagoRecibido,
            monto_penalizacion: montoPenalizacion,
            monto_fee: montoFee,
            motivo_fee: motivoFeeNormalizado,
            cuota_objetivo: round2(resultadoAplicacion.cuotasActualizadas[0]?.monto_total ?? cuotaBaseOriginal),
            faltante_o_excedente: resultadoAplicacion.tipoAplicacion === 'PARCIAL'
              ? resultadoAplicacion.faltante
              : resultadoAplicacion.excedente,
            tipo_aplicacion: resultadoAplicacion.tipoAplicacion,
            diferencia_aplicada: resultadoAplicacion.excedente,
            pendiente_total_actualizado: pendienteTotal,
            saldo_pendiente: pendienteTotal,
            monto_pendiente: pendienteTotal,
            cuotas_restantes: pagosPendientes,
            abono_parcial_acumulado: resultadoAplicacion.abonoParcialAcumulado,
            cuota_actual_id: cuota.id,
            estado_cuota_actual: cuotasPorId.get(cuota.id)?.estado || cuota.estado,
            cuotas_ajustadas: cuotasAjustadas,
            historial: {
              timestamp: ahora.toISOString(),
              analista_id: req.user?.id || null,
              nota: resultadoAplicacion.notaBasePago
            },
            cliente: clienteNombre,
            pagos_hechos: pagosHechos,
            pagos_pendientes: pagosPendientes,
            abono_parcial_acumulado: resultadoAplicacion.abonoParcialAcumulado,
            pagado: pagadoTotal,
            pendiente: pendienteTotal,
            status: estadoPrestamo,
            code: codeByType[resultadoAplicacion.tipoAplicacion] || 'PAYMENT_APPLIED'
          }
        }
      };
    });

    return res.status(resultado.status).json(resultado.body);
  } catch (error) {
    console.error('Error registrando pago semanal:', error);
    return res.status(500).json({
      success: false,
      message: 'Error registrando pago semanal'
    });
  }
});

module.exports = router;
