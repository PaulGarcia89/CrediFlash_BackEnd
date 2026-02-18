const express = require('express');
const router = express.Router();
const { Op, fn, col, literal } = require('sequelize');
const { Prestamo, Solicitud, Cliente, Cuota, sequelize } = require('../models');

const parseFecha = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

router.get('/dashboard', async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta } = req.query;
    const desde = parseFecha(fecha_desde);
    const hasta = parseFecha(fecha_hasta);

    const prestamosWhere = {};
    const solicitudesWhere = {};
    const cuotasWhere = {};

    if (desde || hasta) {
      if (desde && hasta) {
        prestamosWhere.fecha_inicio = { [Op.between]: [desde, hasta] };
        solicitudesWhere.creado_en = { [Op.between]: [desde, hasta] };
        cuotasWhere.fecha_vencimiento = { [Op.between]: [desde, hasta] };
      } else if (desde) {
        prestamosWhere.fecha_inicio = { [Op.gte]: desde };
        solicitudesWhere.creado_en = { [Op.gte]: desde };
        cuotasWhere.fecha_vencimiento = { [Op.gte]: desde };
      } else if (hasta) {
        prestamosWhere.fecha_inicio = { [Op.lte]: hasta };
        solicitudesWhere.creado_en = { [Op.lte]: hasta };
        cuotasWhere.fecha_vencimiento = { [Op.lte]: hasta };
      }
    }

    const [
      totalPrestamos,
      montoTotalPrestado,
      saldoPendienteTotal,
      ticketPromedio,
      plazoPromedioSemanas,
      ingresosIntereses,
      solicitudesTotales,
      solicitudesAprobadas,
      cuotasPagadas,
      cuotasPendientes,
      cuotasParciales
    ] = await Promise.all([
      Prestamo.count({ where: prestamosWhere }),
      Prestamo.sum('monto_solicitado', { where: prestamosWhere }),
      Prestamo.sum('pendiente', { where: prestamosWhere }),
      Prestamo.findOne({
        attributes: [[fn('AVG', col('monto_solicitado')), 'avg']],
        where: prestamosWhere,
        raw: true
      }),
      Prestamo.findOne({
        attributes: [[fn('AVG', col('num_semanas')), 'avg']],
        where: prestamosWhere,
        raw: true
      }),
      Prestamo.sum('ganancias', { where: prestamosWhere }),
      Solicitud.count({ where: solicitudesWhere }),
      Solicitud.count({ where: { ...solicitudesWhere, estado: 'APROBADO' } }),
      Cuota.count({ where: { ...cuotasWhere, estado: 'PAGADO' } }),
      Cuota.count({ where: { ...cuotasWhere, estado: 'PENDIENTE' } }),
      Cuota.count({ where: { ...cuotasWhere, estado: 'PARCIAL' } })
    ]);

    const hoy = new Date();
    const cuotasVencidas = await Cuota.findAll({
      where: {
        ...cuotasWhere,
        estado: { [Op.ne]: 'PAGADO' },
        fecha_vencimiento: { [Op.lt]: hoy }
      },
      attributes: ['monto_total', 'monto_pagado'],
      raw: true
    });

    const montoVencido = cuotasVencidas.reduce((sum, c) => {
      const total = parseFloat(c.monto_total || 0);
      const pagado = parseFloat(c.monto_pagado || 0);
      return sum + Math.max(total - pagado, 0);
    }, 0);

    const prestamosPorMes = await Prestamo.findAll({
      attributes: [
        [fn('DATE_TRUNC', 'month', col('fecha_inicio')), 'mes'],
        [fn('COUNT', col('id')), 'total'],
        [fn('SUM', col('monto_solicitado')), 'monto']
      ],
      where: prestamosWhere,
      group: [fn('DATE_TRUNC', 'month', col('fecha_inicio'))],
      order: [[fn('DATE_TRUNC', 'month', col('fecha_inicio')), 'ASC']],
      raw: true
    });

    const topClientes = await Prestamo.findAll({
      attributes: [
        [col('solicitud.cliente.id'), 'cliente_id'],
        [literal(`CONCAT("solicitud->cliente"."nombre", ' ', "solicitud->cliente"."apellido")`), 'nombre_completo'],
        [fn('SUM', col('Prestamo.monto_solicitado')), 'monto_total']
      ],
      include: [
        {
          model: Solicitud,
          as: 'solicitud',
          attributes: [],
          include: [
            {
              model: Cliente,
              as: 'cliente',
              attributes: []
            }
          ]
        }
      ],
      where: prestamosWhere,
      group: [col('solicitud.cliente.id'), col('solicitud.cliente.nombre'), col('solicitud.cliente.apellido')],
      order: [[fn('SUM', col('Prestamo.monto_solicitado')), 'DESC']],
      limit: 10,
      raw: true
    });

    const promedioTicket = ticketPromedio?.avg ? parseFloat(ticketPromedio.avg) : 0;
    const promedioPlazo = plazoPromedioSemanas?.avg ? parseFloat(plazoPromedioSemanas.avg) : 0;
    const tasaAprobacion = solicitudesTotales > 0 ? (solicitudesAprobadas / solicitudesTotales) * 100 : 0;

    res.json({
      success: true,
      rango: {
        desde: desde ? desde.toISOString() : null,
        hasta: hasta ? hasta.toISOString() : null
      },
      kpis: {
        totalPrestamos: totalPrestamos || 0,
        montoTotalPrestado: parseFloat(montoTotalPrestado || 0),
        saldoPendienteTotal: parseFloat(saldoPendienteTotal || 0),
        ticketPromedio: parseFloat(promedioTicket.toFixed(2)),
        plazoPromedioSemanas: parseFloat(promedioPlazo.toFixed(2)),
        ingresosIntereses: parseFloat(ingresosIntereses || 0),
        tasaAprobacion: {
          aprobadas: solicitudesAprobadas || 0,
          total: solicitudesTotales || 0,
          porcentaje: parseFloat(tasaAprobacion.toFixed(2))
        },
        cuotas: {
          pagadas: cuotasPagadas || 0,
          pendientes: cuotasPendientes || 0,
          parciales: cuotasParciales || 0
        },
        morosidad: {
          vencidas: cuotasVencidas.length,
          monto_vencido: parseFloat(montoVencido.toFixed(2))
        }
      },
      series: {
        prestamosPorMes: prestamosPorMes.map((p) => ({
          mes: p.mes,
          total: parseInt(p.total, 10),
          monto: parseFloat(p.monto || 0)
        }))
      },
      topClientes: topClientes.map((c) => ({
        cliente_id: c.cliente_id,
        nombre_completo: c.nombre_completo,
        monto_total: parseFloat(c.monto_total || 0)
      }))
    });
  } catch (error) {
    console.error('Error en dashboard analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Error generando dashboard analytics'
    });
  }
});

module.exports = router;
