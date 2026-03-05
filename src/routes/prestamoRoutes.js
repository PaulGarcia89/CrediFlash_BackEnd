const express = require('express');
const router = express.Router();
const { Prestamo, Solicitud, Cliente, Cuota, sequelize } = require('../models');
const { Op } = require('sequelize');
const { authenticateToken, requireRole } = require('../middleware/auth');
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

// GET /api/prestamos - Obtener todos los préstamos (paginado y filtrado)
router.get('/', async (req, res) => {
  try {
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

    const prestamosConClienteId = prestamos.map((prestamo) => ({
      ...prestamo.toJSON(),
      cliente_id: prestamo?.solicitud?.cliente_id || null
    }));

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
        fecha_vencimiento: item.fecha_vencimiento
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
          { key: 'fecha_vencimiento', label: 'fecha_vencimiento' }
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
router.post('/', async (req, res) => {
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
  requireRole('ANALISTA', 'SUPERVISOR', 'ADMINISTRADOR'),
  async (req, res) => {
  try {
    const { solicitudId } = req.params;
    const { fecha_inicio, modalidad = 'SEMANAL', num_dias = 0 } = req.body;
    const resultado = await sequelize.transaction(async (transaction) => {
      const solicitud = await Solicitud.findByPk(solicitudId, {
        include: [{ model: Cliente, as: 'cliente' }],
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (!solicitud) {
        return { status: 404, body: { success: false, message: 'Solicitud no encontrada' } };
      }

      if (solicitud.estado !== 'PENDIENTE') {
        return { status: 400, body: { success: false, message: 'La solicitud debe estar en estado PENDIENTE' } };
      }

      const prestamoExistente = await Prestamo.findOne({
        where: { solicitud_id: solicitud.id },
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (prestamoExistente) {
        return { status: 400, body: { success: false, message: 'La solicitud ya tiene un préstamo asociado' } };
      }

      const fechaAprobacion = new Date();
      const fechaInicio = fecha_inicio ? new Date(fecha_inicio) : new Date();
      const montoSolicitado = parseFloat(solicitud.monto_solicitado) || 0;
      const tasaInteres = parseFloat(solicitud.tasa_variable || 0) * 100;
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
        nombre_completo: `${solicitud.cliente.nombre} ${solicitud.cliente.apellido}`,
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
        anio_vencimiento: null
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

      return {
        status: 201,
        body: {
          success: true,
          message: 'Préstamo creado exitosamente',
          data: {
            prestamo,
            cuotas_generadas: cuotasGeneradas
          }
        }
      };
    });

    return res.status(resultado.status).json(resultado.body);
  } catch (error) {
    console.error('Error creando préstamo desde solicitud:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creando préstamo desde solicitud'
    });
  }
  }
);

// POST /api/prestamos/:id/pago-semanal - Registrar pago de cuota semanal desde préstamo
router.post('/:id/pago-semanal', async (req, res) => {
  try {
    const { id } = req.params;
    const { monto_pago } = req.body;

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
        return { status: 404, body: { success: false, message: 'Préstamo no encontrado' } };
      }

      if ((prestamo.status || '').toUpperCase() === 'PAGADO') {
        return { status: 400, body: { success: false, message: 'El préstamo ya está pagado' } };
      }

      const cuota = await Cuota.findOne({
        where: { prestamo_id: id, estado: 'PENDIENTE' },
        order: [['fecha_vencimiento', 'ASC']],
        transaction
      });

      if (!cuota) {
        return { status: 400, body: { success: false, message: 'No hay cuotas pendientes para este préstamo' } };
      }

      const montoPagoEsperado = parseFloat(prestamo.pagos_semanales) || 0;
      const montoPagoRecibido = parseFloat(monto_pago);

      if (!monto_pago || isNaN(montoPagoRecibido)) {
        return { status: 400, body: { success: false, message: 'monto_pago es requerido' } };
      }

      if (montoPagoRecibido !== montoPagoEsperado) {
        return {
          status: 400,
          body: {
            success: false,
            message: 'El monto del pago debe ser exactamente igual a pagos_semanales',
            expected: montoPagoEsperado
          }
        };
      }

      const montoCuota = parseFloat(cuota.monto_total) || 0;
      if (montoCuota !== montoPagoEsperado) {
        return {
          status: 400,
          body: {
            success: false,
            message: 'La cuota pendiente no corresponde al pago semanal. Regenera cuotas semanales para este préstamo.',
            cuota_monto_total: montoCuota,
            pagos_semanales: montoPagoEsperado
          }
        };
      }

      // Registrar pago completo de la cuota
      cuota.monto_pagado = montoCuota;
      cuota.fecha_pago = new Date();
      cuota.estado = 'PAGADO';
      await cuota.save({ transaction });

      const montoPago = montoPagoRecibido;
      const pagosHechos = (parseInt(prestamo.pagos_hechos) || 0) + 1;
      const totalSemanas = parseInt(prestamo.num_semanas) || 0;
      const pagosPendientes = Math.max(totalSemanas - pagosHechos, 0);

      const pagadoTotal = (parseFloat(prestamo.pagado) || 0) + montoPago;
      const pendienteTotal = Math.max((parseFloat(prestamo.pendiente) || 0) - montoPago, 0);

      const status = pagosPendientes === 0 ? 'PAGADO' : `LE QUEDAN ${pagosPendientes} PAGOS POR PAGAR`;

      await prestamo.update(
        {
          pagos_hechos: pagosHechos,
          pagos_pendientes: pagosPendientes,
          pagado: pagadoTotal,
          pendiente: pendienteTotal,
          status
        },
        { transaction }
      );

      const clienteNombre = prestamo?.solicitud?.cliente
        ? `${prestamo.solicitud.cliente.nombre} ${prestamo.solicitud.cliente.apellido}`
        : prestamo.nombre_completo || null;

      return {
        status: 200,
        body: {
          success: true,
          message: '✅ Pago de cuota registrado',
          data: {
            cliente: clienteNombre,
            monto_total: parseFloat(prestamo.total_pagar) || 0,
            num_semanas: parseInt(prestamo.num_semanas) || 0,
            cuotas_restantes: pagosPendientes,
            cuota_id: cuota.id,
            monto_pagado: montoPago,
            pagos_hechos: pagosHechos,
            pagos_pendientes: pagosPendientes,
            pagado: pagadoTotal,
            pendiente: pendienteTotal,
            status
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
