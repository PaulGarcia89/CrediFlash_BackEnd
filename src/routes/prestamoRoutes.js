const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const { Prestamo, Solicitud, Cliente, Cuota, SolicitudDocumento, sequelize } = require('../models');
const { Op } = require('sequelize');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { sendCsv } = require('../utils/exporter');

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

const generarPlanCuotasSemanales = ({ prestamoId, fechaInicio, numSemanas, montoSolicitado, totalPagar }) => {
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

  for (let index = 1; index <= semanas; index += 1) {
    const fechaVencimiento = new Date(fechaInicio);
    fechaVencimiento.setDate(fechaVencimiento.getDate() + (index * 7));

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

// GET /api/prestamos - Obtener todos los préstamos (paginado y filtrado)
router.get('/', authenticateToken, requirePermission('prestamos.view'), async (req, res) => {
  try {
    await ensureSolicitudDocumentoSchema();
    await ensurePrestamoContratoColumn();
    const {
      page = 1,
      limit = 20,
      prestamo_id,
      status,
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
      where.status = status;
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
      order: [['fecha_inicio', 'DESC']]
    };

    if (format !== 'csv') {
      queryOptions.limit = parseInt(limit);
      queryOptions.offset = offset;
    }

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

      return {
        ...raw,
        cliente_id: raw?.solicitud?.cliente_id || null,
        contrato_credito_id: contratoDoc?.id || null,
        contrato_url: contratoDoc
          ? construirUrlDocumento(req, contratoDoc.id, 'inline')
          : construirUrlArchivoRelativo(req, raw?.contrato)
      };
    });

    if (format === 'csv') {
      const csvRows = prestamosConClienteId.map((item) => ({
        id: item.id,
        cliente_id: item.cliente_id,
        nombre_completo: item.nombre_completo,
        fecha_inicio: item.fecha_inicio,
        monto_solicitado: item.monto_solicitado,
        interes: item.interes,
        num_semanas: item.num_semanas,
        total_pagar: item.total_pagar,
        pagos_semanales: item.pagos_semanales,
        pagos_hechos: item.pagos_hechos,
        pagos_pendientes: item.pagos_pendientes,
        pendiente: item.pendiente,
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
          { key: 'fecha_inicio', label: 'fecha_inicio' },
          { key: 'monto_solicitado', label: 'monto_solicitado' },
          { key: 'interes', label: 'interes' },
          { key: 'num_semanas', label: 'num_semanas' },
          { key: 'total_pagar', label: 'total_pagar' },
          { key: 'pagos_semanales', label: 'pagos_semanales' },
          { key: 'pagos_hechos', label: 'pagos_hechos' },
          { key: 'pagos_pendientes', label: 'pagos_pendientes' },
          { key: 'pendiente', label: 'pendiente' },
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
    const { fecha_inicio, num_dias = 0 } = req.body;
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
      const fechaInicio = fecha_inicio ? new Date(fecha_inicio) : new Date();
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

      const fechaVencimiento = calcularFechaVencimiento(fechaInicio, semanas);

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
        pagos_pendientes: totalPagar,
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
        const ultimaCuota = await Cuota.findOne({
          where: { prestamo_id: prestamo.id },
          order: [['fecha_vencimiento', 'DESC']],
          transaction
        });

        if (ultimaCuota) {
          const montoUltimaCuota = parseFloat(ultimaCuota.monto_total || 0);
          descuentoReferidoAplicado = parseFloat(Math.min(montoReferidoCliente, montoUltimaCuota).toFixed(2));

          if (descuentoReferidoAplicado > 0) {
            ultimaCuota.monto_total = parseFloat((montoUltimaCuota - descuentoReferidoAplicado).toFixed(2));
            ultimaCuota.observaciones = ultimaCuota.observaciones
              ? `${ultimaCuota.observaciones}\nDescuento referido aplicado: -${descuentoReferidoAplicado.toFixed(2)} USD`
              : `Descuento referido aplicado: -${descuentoReferidoAplicado.toFixed(2)} USD`;
            await ultimaCuota.save({ transaction });

            await prestamo.update({
              total_pagar: parseFloat((parseFloat(prestamo.total_pagar || 0) - descuentoReferidoAplicado).toFixed(2)),
              ganancias: parseFloat((parseFloat(prestamo.ganancias || 0) - descuentoReferidoAplicado).toFixed(2)),
              pendiente: parseFloat((parseFloat(prestamo.pendiente || 0) - descuentoReferidoAplicado).toFixed(2)),
              pagos_pendientes: parseFloat((parseFloat(prestamo.pagos_pendientes || 0) - descuentoReferidoAplicado).toFixed(2))
            }, { transaction });

            await cliente.update({
              descuentos_referido_disponibles: Math.max(descuentosDisponibles - 1, 0),
              descuentos_referido_aplicados: (parseInt(cliente.descuentos_referido_aplicados, 10) || 0) + 1
            }, { transaction });
          }
        }
      }

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

      return {
        status: 201,
        body: {
          success: true,
          message: '✅ Solicitud aprobada y contrato registrado',
          data: {
            prestamo,
            cuotas_generadas: cuotasGeneradas,
            descuento_referido_aplicado: descuentoReferidoAplicado,
            contrato_credito_id: contrato.id,
            contrato: {
              id: contrato.id,
              nombre: contrato.nombre_original,
              tipo: 'CONTRATO_CREDITO',
              storage_path: prestamo.contrato,
              url: construirUrlArchivoRelativo(req, prestamo.contrato),
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

// POST /api/prestamos/:id/pago-semanal - Registrar pago de cuota semanal desde préstamo
router.post('/:id/pago-semanal', authenticateToken, requirePermission('prestamos.pay'), async (req, res) => {
  try {
    const { id } = req.params;
    const { monto_pago, monto_penalizacion = 0 } = req.body;

    const buildError = (status, message, code = 'PAYMENT_RULE_VIOLATION') => ({
      status,
      body: {
        success: false,
        message,
        code
      }
    });

    const resultado = await sequelize.transaction(async (transaction) => {
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

      if (!monto_pago || isNaN(montoPagoRecibido)) {
        return buildError(400, 'El monto ingresado no coincide con las reglas de pago configuradas.', 'PAYMENT_RULE_VIOLATION');
      }

      if (montoPagoRecibido <= 0) {
        return buildError(400, 'El monto ingresado no coincide con las reglas de pago configuradas.', 'PAYMENT_RULE_VIOLATION');
      }

      if (isNaN(montoPenalizacion) || montoPenalizacion < 0) {
        return buildError(400, 'El monto ingresado no coincide con las reglas de pago configuradas.', 'INVALID_PENALTY_AMOUNT');
      }

      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const fechaVencimientoCuota = new Date(cuota.fecha_vencimiento);
      fechaVencimientoCuota.setHours(0, 0, 0, 0);
      const cuotaVencida = fechaVencimientoCuota < hoy;

      if (!cuotaVencida && montoPenalizacion > 0) {
        return buildError(400, 'El monto ingresado no coincide con las reglas de pago configuradas.', 'INVALID_PENALTY_AMOUNT');
      }

      const montoCuota = parseFloat(cuota.monto_total) || 0;
      const saldoCuotaActual = parseFloat((montoCuota - (parseFloat(cuota.monto_pagado || 0))).toFixed(2));
      const montoEsperadoConPenalizacion = parseFloat((saldoCuotaActual + montoPenalizacion).toFixed(2));
      const diferencia = parseFloat((montoPagoRecibido - montoEsperadoConPenalizacion).toFixed(2));
      const cuotasAjustadas = [];
      const ahora = new Date();

      if (montoPagoRecibido < montoPenalizacion) {
        return buildError(400, 'El monto ingresado no coincide con las reglas de pago configuradas.', 'PAYMENT_RULE_VIOLATION');
      }

      let tipoAplicacion = 'COMPLETO';
      let diferenciaAplicada = 0;

      const notaBasePago = `Aplicación de pago semanal: recibido=${montoPagoRecibido.toFixed(2)}, esperado=${montoEsperadoConPenalizacion.toFixed(2)}, penalización=${montoPenalizacion.toFixed(2)}`;
      const delta = parseFloat((montoPagoRecibido - montoEsperadoConPenalizacion).toFixed(2));

      if (delta < -0.009) {
        // Pago parcial
        tipoAplicacion = 'PARCIAL';
        const abonoCuotaActual = Math.max(parseFloat((montoPagoRecibido - montoPenalizacion).toFixed(2)), 0);
        const montoPagadoActual = parseFloat(cuota.monto_pagado || 0);
        cuota.monto_pagado = parseFloat((montoPagadoActual + abonoCuotaActual).toFixed(2));
        cuota.estado = 'PENDIENTE';
        cuota.observaciones = cuota.observaciones
          ? `${cuota.observaciones}\n${notaBasePago}`
          : notaBasePago;
        await cuota.save({ transaction });

        const saldoRestante = parseFloat((montoCuota - cuota.monto_pagado).toFixed(2));

        cuotasAjustadas.push({
          cuota_id: cuota.id,
          ajuste: parseFloat(abonoCuotaActual.toFixed(2)),
          nuevo_monto: Math.max(saldoRestante, 0)
        });
        diferenciaAplicada = parseFloat(Math.abs(delta).toFixed(2)); // faltante
      } else {
        // Pago exacto o sobrepago: cerrar cuota actual
        cuota.monto_pagado = montoCuota;
        cuota.fecha_pago = ahora;
        cuota.estado = 'PAGADO';
        cuota.observaciones = cuota.observaciones
          ? `${cuota.observaciones}\n${notaBasePago}`
          : notaBasePago;
        await cuota.save({ transaction });
        diferenciaAplicada = parseFloat(delta.toFixed(2));
      }

      if (delta > 0.009) {
        // Pago adelantado: aplicar excedente en cascada sobre próximas cuotas
        tipoAplicacion = 'ADELANTADO';
        let excedente = delta;

        for (let i = 1; i < cuotasPendientes.length && excedente > 0; i += 1) {
          const cuotaDestino = cuotasPendientes[i];
          const montoTotalDestino = parseFloat(cuotaDestino.monto_total || 0);
          const montoPagadoDestino = parseFloat(cuotaDestino.monto_pagado || 0);
          const saldoDestino = parseFloat((montoTotalDestino - montoPagadoDestino).toFixed(2));
          if (saldoDestino <= 0) continue;

          const aplicado = parseFloat(Math.min(excedente, saldoDestino).toFixed(2));
          cuotaDestino.monto_pagado = parseFloat((montoPagadoDestino + aplicado).toFixed(2));
          cuotaDestino.observaciones = cuotaDestino.observaciones
            ? `${cuotaDestino.observaciones}\nAjuste ADELANTADO desde cuota ${cuota.id}: -${aplicado.toFixed(2)}`
            : `Ajuste ADELANTADO desde cuota ${cuota.id}: -${aplicado.toFixed(2)}`;

          if (cuotaDestino.monto_pagado >= montoTotalDestino) {
            cuotaDestino.monto_pagado = montoTotalDestino;
            cuotaDestino.estado = 'PAGADO';
            cuotaDestino.fecha_pago = ahora;
          } else {
            cuotaDestino.estado = 'PENDIENTE';
          }

          await cuotaDestino.save({ transaction });

          const nuevoSaldo = parseFloat((parseFloat(cuotaDestino.monto_total || 0) - parseFloat(cuotaDestino.monto_pagado || 0)).toFixed(2));
          cuotasAjustadas.push({
            cuota_id: cuotaDestino.id,
            ajuste: parseFloat((-aplicado).toFixed(2)),
            nuevo_monto: Math.max(nuevoSaldo, 0)
          });

          excedente = parseFloat((excedente - aplicado).toFixed(2));
        }

        if (excedente > 0) {
          diferenciaAplicada = parseFloat((delta - excedente).toFixed(2));
        }
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

      const pagadoTotal = parseFloat(metrics.pagadoTotal.toFixed(2));
      const pendienteTotal = parseFloat(metrics.pendienteTotal.toFixed(2));
      const pagosPendientes = metrics.cuotasConSaldo;
      const pagosHechos = cuotasActualizadas.length - pagosPendientes;
      const prestamoPagado = pagosPendientes === 0 && pendienteTotal <= 0;
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
            monto_aplicado: montoPagoRecibido,
            monto_penalizacion: montoPenalizacion,
            cuota_objetivo: montoEsperadoConPenalizacion,
            faltante_o_excedente: tipoAplicacion === 'PARCIAL'
              ? parseFloat(Math.abs(delta).toFixed(2))
              : parseFloat((-Math.max(delta, 0)).toFixed(2)),
            tipo_aplicacion: tipoAplicacion,
            diferencia_aplicada: diferenciaAplicada,
            pendiente_total_actualizado: pendienteTotal,
            cuotas_restantes: pagosPendientes,
            cuota_actual_id: cuota.id,
            cuotas_ajustadas: cuotasAjustadas,
            cliente: clienteNombre,
            pagos_hechos: pagosHechos,
            pagos_pendientes: pagosPendientes,
            pagado: pagadoTotal,
            pendiente: pendienteTotal,
            status: estadoPrestamo,
            code: codeByType[tipoAplicacion] || 'PAYMENT_APPLIED'
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
