// src/controllers/cuotaController.js - Ajustado para tu estructura
const { Cuota, Prestamo, Solicitud, Cliente } = require('../models');
const { Op } = require('sequelize');
const { sendCsv } = require('../utils/exporter');

const cuotaController = {
  // Obtener todas las cuotas
  getAllCuotas: async (req, res) => {
    try {
      const { page = 1, limit = 20, prestamo_id, estado, format } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      const whereClause = {};
      if (prestamo_id) whereClause.prestamo_id = prestamo_id;
      if (estado) whereClause.estado = estado;
      
      const queryOptions = {
        where: whereClause,
        include: [
          {
            model: Prestamo,
            as: 'prestamo',
            include: [
              {
                model: Solicitud,
                as: 'solicitud',
                include: [
                  {
                    model: Cliente,
                    as: 'cliente',
                    attributes: ['id', 'nombre', 'apellido', 'email']
                  }
                ]
              }
            ]
          }
        ],
        order: [['fecha_vencimiento', 'ASC']]
      };

      if (format !== 'csv') {
        queryOptions.limit = parseInt(limit);
        queryOptions.offset = offset;
      }

      const cuotas = await Cuota.findAndCountAll(queryOptions);

      if (format === 'csv') {
        const csvRows = cuotas.rows.map((cuota) => ({
          id: cuota.id,
          prestamo_id: cuota.prestamo_id,
          cliente_id: cuota?.prestamo?.solicitud?.cliente?.id || '',
          cliente_nombre: cuota?.prestamo?.solicitud?.cliente
            ? `${cuota.prestamo.solicitud.cliente.nombre} ${cuota.prestamo.solicitud.cliente.apellido}`
            : '',
          fecha_vencimiento: cuota.fecha_vencimiento,
          monto_capital: cuota.monto_capital,
          monto_interes: cuota.monto_interes,
          monto_total: cuota.monto_total,
          estado: cuota.estado,
          fecha_pago: cuota.fecha_pago,
          monto_pagado: cuota.monto_pagado,
          observaciones: cuota.observaciones
        }));

        return sendCsv(res, {
          filename: `cuotas_${Date.now()}.csv`,
          headers: [
            { key: 'id', label: 'id' },
            { key: 'prestamo_id', label: 'prestamo_id' },
            { key: 'cliente_id', label: 'cliente_id' },
            { key: 'cliente_nombre', label: 'cliente_nombre' },
            { key: 'fecha_vencimiento', label: 'fecha_vencimiento' },
            { key: 'monto_capital', label: 'monto_capital' },
            { key: 'monto_interes', label: 'monto_interes' },
            { key: 'monto_total', label: 'monto_total' },
            { key: 'estado', label: 'estado' },
            { key: 'fecha_pago', label: 'fecha_pago' },
            { key: 'monto_pagado', label: 'monto_pagado' },
            { key: 'observaciones', label: 'observaciones' }
          ],
          rows: csvRows
        });
      }
      
      res.json({
        success: true,
        data: cuotas.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: cuotas.count,
          pages: Math.ceil(cuotas.count / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('❌ Error en getAllCuotas:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener las cuotas'
      });
    }
  },

  // Obtener cuota por ID
  getCuotaById: async (req, res) => {
    try {
      const cuota = await Cuota.findByPk(req.params.id, {
        include: [
          {
            model: Prestamo,
            as: 'prestamo',
            include: [
              {
                model: Solicitud,
                as: 'solicitud',
                include: [
                  {
                    model: Cliente,
                    as: 'cliente',
                    attributes: ['id', 'nombre', 'apellido', 'email', 'telefono']
                  }
                ]
              }
            ]
          }
        ]
      });
      
      if (!cuota) {
        return res.status(404).json({
          success: false,
          message: 'Cuota no encontrada'
        });
      }
      
      res.json({
        success: true,
        data: cuota
      });
    } catch (error) {
      console.error('❌ Error en getCuotaById:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener la cuota'
      });
    }
  },

  // Obtener cuotas por préstamo
  getCuotasByPrestamo: async (req, res) => {
    try {
      const cuotas = await Cuota.obtenerCuotasPorPrestamo(req.params.prestamoId);
      
      if (cuotas.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No se encontraron cuotas para este préstamo'
        });
      }
      
      // Obtener resumen
      const resumen = await Cuota.obtenerResumenCuotas(req.params.prestamoId);
      
      res.json({
        success: true,
        data: cuotas,
        resumen: resumen
      });
    } catch (error) {
      console.error('❌ Error en getCuotasByPrestamo:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener las cuotas del préstamo'
      });
    }
  },

  // Crear nueva cuota
  createCuota: async (req, res) => {
    try {
      const nuevaCuota = await Cuota.create({
        ...req.body,
        created_at: new Date()
      });
      
      res.status(201).json({
        success: true,
        message: '✅ Cuota creada exitosamente',
        data: nuevaCuota
      });
    } catch (error) {
      console.error('❌ Error en createCuota:', error);
      res.status(500).json({
        success: false,
        message: 'Error al crear la cuota',
        error: error.message
      });
    }
  },

  // Actualizar cuota
  updateCuota: async (req, res) => {
    try {
      const cuota = await Cuota.findByPk(req.params.id);
      
      if (!cuota) {
        return res.status(404).json({
          success: false,
          message: 'Cuota no encontrada'
        });
      }
      
      // Campos que se pueden actualizar
      const camposPermitidos = [
        'fecha_vencimiento', 'monto_capital', 'monto_interes', 
        'monto_total', 'estado', 'observaciones'
      ];
      
      const datosActualizar = {};
      for (const campo of camposPermitidos) {
        if (req.body[campo] !== undefined) {
          datosActualizar[campo] = req.body[campo];
        }
      }
      
      await cuota.update(datosActualizar);
      
      res.json({
        success: true,
        message: '✅ Cuota actualizada exitosamente',
        data: cuota
      });
    } catch (error) {
      console.error('❌ Error en updateCuota:', error);
      res.status(500).json({
        success: false,
        message: 'Error al actualizar la cuota'
      });
    }
  },

  // Registrar pago de cuota
  registrarPago: async (req, res) => {
    try {
      const { monto_pagado, observaciones } = req.body;
      
      if (!monto_pagado || monto_pagado <= 0) {
        return res.status(400).json({
          success: false,
          message: 'El monto pagado es requerido y debe ser mayor a 0'
        });
      }
      
      const cuota = await Cuota.findByPk(req.params.id);
      
      if (!cuota) {
        return res.status(404).json({
          success: false,
          message: 'Cuota no encontrada'
        });
      }
      
      if (cuota.estado === 'PAGADO') {
        return res.status(400).json({
          success: false,
          message: 'La cuota ya está completamente pagada'
        });
      }
      
      // Registrar el pago
      const resultado = await cuota.marcarComoPagada(monto_pagado, observaciones);
      
      res.json({
        success: true,
        message: '✅ Pago registrado exitosamente',
        data: resultado
      });
    } catch (error) {
      console.error('❌ Error en registrarPago:', error);
      res.status(500).json({
        success: false,
        message: 'Error al registrar el pago'
      });
    }
  },

  // Eliminar cuota
  deleteCuota: async (req, res) => {
    try {
      const cuota = await Cuota.findByPk(req.params.id);
      
      if (!cuota) {
        return res.status(404).json({
          success: false,
          message: 'Cuota no encontrada'
        });
      }
      
      // Solo permitir eliminar cuotas pendientes sin pagos
      if (cuota.monto_pagado > 0) {
        return res.status(400).json({
          success: false,
          message: 'No se puede eliminar una cuota con pagos registrados'
        });
      }
      
      await cuota.destroy();
      
      res.json({
        success: true,
        message: '✅ Cuota eliminada exitosamente'
      });
    } catch (error) {
      console.error('❌ Error en deleteCuota:', error);
      res.status(500).json({
        success: false,
        message: 'Error al eliminar la cuota'
      });
    }
  },

  // Generar cuotas para un préstamo
  generarCuotasParaPrestamo: async (req, res) => {
    try {
      const { prestamoId } = req.params;
      const { monto_total, plazo_meses, fecha_inicio, tasa_interes } = req.body;
      
      // Validar datos
      if (!monto_total || !plazo_meses || !fecha_inicio) {
        return res.status(400).json({
          success: false,
          message: 'Faltan datos requeridos: monto_total, plazo_meses, fecha_inicio'
        });
      }
      
      // Verificar si el préstamo existe
      const prestamo = await Prestamo.findByPk(prestamoId);
      if (!prestamo) {
        return res.status(404).json({
          success: false,
          message: 'Préstamo no encontrado'
        });
      }
      
      // Verificar si ya tiene cuotas
      const cuotasExistentes = await Cuota.count({ where: { prestamo_id: prestamoId } });
      if (cuotasExistentes > 0) {
        return res.status(400).json({
          success: false,
          message: 'Este préstamo ya tiene cuotas generadas'
        });
      }
      
      // Generar cuotas
      const datosPrestamo = {
        monto_total: parseFloat(monto_total),
        plazo_meses: parseInt(plazo_meses),
        fecha_inicio: new Date(fecha_inicio),
        tasa_interes: tasa_interes || 12
      };
      
      const cuotasGeneradas = await Cuota.generarCuotasParaPrestamo(
        prestamoId, 
        datosPrestamo
      );
      
      res.json({
        success: true,
        message: `✅ ${cuotasGeneradas.length} cuotas generadas exitosamente`,
        data: cuotasGeneradas,
        resumen: {
          monto_total: datosPrestamo.monto_total,
          plazo_meses: datosPrestamo.plazo_meses,
          monto_cuota: parseFloat((datosPrestamo.monto_total / datosPrestamo.plazo_meses).toFixed(2))
        }
      });
    } catch (error) {
      console.error('❌ Error en generarCuotasParaPrestamo:', error);
      res.status(500).json({
        success: false,
        message: 'Error al generar cuotas para el préstamo',
        error: error.message
      });
    }
  },

  // Generar cuotas SEMANALES para un préstamo
  generarCuotasSemanalesParaPrestamo: async (req, res) => {
    try {
      const { prestamoId } = req.params;
      const { force = false } = req.body;

      const prestamo = await Prestamo.findByPk(prestamoId);
      if (!prestamo) {
        return res.status(404).json({
          success: false,
          message: 'Préstamo no encontrado'
        });
      }

      const cuotasExistentes = await Cuota.count({ where: { prestamo_id: prestamoId } });
      if (cuotasExistentes > 0 && !force) {
        return res.status(400).json({
          success: false,
          message: 'Este préstamo ya tiene cuotas generadas. Envíe force=true para regenerar.'
        });
      }

      if (cuotasExistentes > 0 && force) {
        await Cuota.destroy({ where: { prestamo_id: prestamoId } });
      }

      const datosPrestamo = {
        monto_total: parseFloat(prestamo.total_pagar),
        num_semanas: parseInt(prestamo.num_semanas),
        fecha_inicio: new Date(prestamo.fecha_inicio)
      };

      const cuotasGeneradas = await Cuota.generarCuotasSemanalesParaPrestamo(
        prestamoId,
        datosPrestamo
      );

      res.json({
        success: true,
        message: `✅ ${cuotasGeneradas.length} cuotas semanales generadas exitosamente`,
        data: cuotasGeneradas,
        resumen: {
          monto_total: datosPrestamo.monto_total,
          num_semanas: datosPrestamo.num_semanas,
          monto_cuota: parseFloat((datosPrestamo.monto_total / datosPrestamo.num_semanas).toFixed(2))
        }
      });
    } catch (error) {
      console.error('❌ Error en generarCuotasSemanalesParaPrestamo:', error);
      res.status(500).json({
        success: false,
        message: 'Error al generar cuotas semanales para el préstamo',
        error: error.message
      });
    }
  },

  // Generar cuotas SEMANALES para TODOS los préstamos
  generarCuotasSemanalesParaTodos: async (req, res) => {
    try {
      const { force = false } = req.body;

      const prestamos = await Prestamo.findAll();
      if (prestamos.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No hay préstamos para procesar'
        });
      }

      let totalCuotas = 0;
      let procesados = 0;
      const errores = [];

      for (const prestamo of prestamos) {
        try {
          const cuotasExistentes = await Cuota.count({ where: { prestamo_id: prestamo.id } });
          if (cuotasExistentes > 0 && !force) {
            continue;
          }

          if (cuotasExistentes > 0 && force) {
            await Cuota.destroy({ where: { prestamo_id: prestamo.id } });
          }

          const datosPrestamo = {
            monto_total: parseFloat(prestamo.total_pagar),
            num_semanas: parseInt(prestamo.num_semanas),
            fecha_inicio: new Date(prestamo.fecha_inicio)
          };

          const cuotasGeneradas = await Cuota.generarCuotasSemanalesParaPrestamo(
            prestamo.id,
            datosPrestamo
          );

          totalCuotas += cuotasGeneradas.length;
          procesados += 1;
        } catch (error) {
          errores.push({
            prestamo_id: prestamo.id,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        message: '✅ Cuotas semanales generadas para préstamos',
        resumen: {
          prestamos_procesados: procesados,
          cuotas_generadas: totalCuotas,
          errores: errores.length
        },
        errores
      });
    } catch (error) {
      console.error('❌ Error en generarCuotasSemanalesParaTodos:', error);
      res.status(500).json({
        success: false,
        message: 'Error al generar cuotas semanales para todos los préstamos',
        error: error.message
      });
    }
  },

  // Obtener cuotas vencidas
  getCuotasVencidas: async (req, res) => {
    try {
      const cuotasVencidas = await Cuota.obtenerCuotasVencidas();
      
      const totalVencido = parseFloat(cuotasVencidas.reduce((sum, c) => 
        sum + (parseFloat(c.monto_total) - parseFloat(c.monto_pagado || 0)), 0).toFixed(2));
      
      res.json({
        success: true,
        data: cuotasVencidas,
        resumen: {
          total_cuotas: cuotasVencidas.length,
          monto_total_vencido: totalVencido,
          cliente_mas_vencido: cuotasVencidas.length > 0 ? 
            await this.getClienteMasVencido(cuotasVencidas) : null
        }
      });
    } catch (error) {
      console.error('❌ Error en getCuotasVencidas:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener cuotas vencidas'
      });
    }
  },

  // Helper: Obtener cliente con más cuotas vencidas
  getClienteMasVencido: async function(cuotasVencidas) {
    try {
      const prestamoIds = [...new Set(cuotasVencidas.map(c => c.prestamo_id))];
      
      if (prestamoIds.length === 0) return null;
      
      const prestamos = await Prestamo.findAll({
        where: { id: prestamoIds },
        include: [
          {
            model: Solicitud,
            as: 'solicitud',
            include: [
              {
                model: Cliente,
                as: 'cliente',
                attributes: ['id', 'nombre', 'apellido']
              }
            ]
          }
        ]
      });
      
      return prestamos.length > 0 ? prestamos[0].solicitud.cliente : null;
    } catch (error) {
      console.error('Error obteniendo cliente más vencido:', error);
      return null;
    }
  },

  // Obtener estadísticas de cuotas
  getEstadisticasCuotas: async (req, res) => {
    try {
      const [
        totalCuotas,
        cuotasPagadas,
        cuotasPendientes,
        montoTotalPagado,
        montoTotalPendiente,
        cuotasVencidas
      ] = await Promise.all([
        Cuota.count(),
        Cuota.count({ where: { estado: 'PAGADO' } }),
        Cuota.count({ where: { estado: 'PENDIENTE' } }),
        Cuota.sum('monto_pagado'),
        Cuota.sum('monto_total'),
        Cuota.obtenerCuotasVencidas()
      ]);
      
      const montoTotal = parseFloat((montoTotalPendiente || 0).toFixed(2));
      const montoPagado = parseFloat((montoTotalPagado || 0).toFixed(2));
      const montoPendiente = parseFloat((montoTotal - montoPagado).toFixed(2));
      
      res.json({
        success: true,
        data: {
          total_cuotas: totalCuotas || 0,
          estado: {
            pagadas: cuotasPagadas || 0,
            pendientes: cuotasPendientes || 0,
            vencidas: cuotasVencidas.length || 0
          },
          montos: {
            total: montoTotal,
            pagado: montoPagado,
            pendiente: montoPendiente,
            porcentaje_pagado: montoTotal > 0 ? 
              parseFloat(((montoPagado / montoTotal) * 100).toFixed(2)) : 0
          },
          promedio_por_prestamo: totalCuotas > 0 ? 
            parseFloat((montoTotal / totalCuotas).toFixed(2)) : 0
        }
      });
    } catch (error) {
      console.error('❌ Error en getEstadisticasCuotas:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener estadísticas de cuotas'
      });
    }
  }
};

module.exports = cuotaController;
