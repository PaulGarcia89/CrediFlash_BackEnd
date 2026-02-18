const { Op, Sequelize } = require('sequelize');

class SolicitudController {
  constructor(models) {
    this.Solicitud = models.Solicitud;
    this.Cliente = models.Cliente;
    this.Analista = models.Analista;
    this.ModeloAprobacion = models.ModeloAprobacion;
    this.Prestamo = models.Prestamo;
  }

  // Crear solicitud
  async crearSolicitud(req, res) {
    try {
      console.log('📝 Recibiendo solicitud:', req.body);
      
      const { cliente_id, monto_solicitado, plazo_semanas, tasa_variable, modelo_aprobacion_id, modelo_calificacion, destino } = req.body;
      
      // Validaciones básicas
      if (!cliente_id) {
        return res.status(400).json({
          success: false,
          message: 'El cliente_id es requerido'
        });
      }
      
      if (!monto_solicitado || monto_solicitado <= 0) {
        return res.status(400).json({
          success: false,
          message: 'El monto_solicitado es requerido y debe ser mayor a 0'
        });
      }
      
      if (!plazo_semanas || plazo_semanas <= 0) {
        return res.status(400).json({
          success: false,
          message: 'El plazo_semanas es requerido y debe ser mayor a 0'
        });
      }
      
      // Verificar que el cliente existe
      const cliente = await Cliente.findByPk(cliente_id);
      if (!cliente) {
        return res.status(404).json({
          success: false,
          message: 'Cliente no encontrado'
        });
      }
      
      // Crear solicitud
      const solicitudData = {
        cliente_id,
        monto_solicitado: parseFloat(monto_solicitado),
        plazo_semanas: parseInt(plazo_semanas),
        tasa_variable: tasa_variable ? parseFloat(tasa_variable) : 0.12,
        modelo_aprobacion_id: modelo_aprobacion_id || null,
        modelo_calificacion: modelo_calificacion ? modelo_calificacion : null,
        estado: 'PENDIENTE',
        creado_en: new Date(),
        destino: destino || null
      };
      
      const solicitud = await Solicitud.create(solicitudData);
      
      res.status(201).json({
        success: true,
        message: '✅ Solicitud creada exitosamente',
        data: {
          id: solicitud.id,
          cliente_id: solicitud.cliente_id,
          monto_solicitado: solicitud.monto_solicitado,
          plazo_semanas: solicitud.plazo_semanas,
          tasa_variable: solicitud.tasa_variable,
          modelo_aprobacion_id: solicitud.modelo_aprobacion_id,
          modelo_calificacion: solicitud.modelo_calificacion,
          estado: solicitud.estado,
          creado_en: solicitud.creado_en,
          destino: solicitud.destino,
          cliente: {
            id: cliente.id,
            nombre: cliente.nombre,
            apellido: cliente.apellido
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Error creando solicitud:', error.message);
      res.status(500).json({
        success: false,
        message: 'Error creando solicitud',
        error: error.message
      });
    }
  }
  

  // Obtener todas las solicitudes
  async obtenerSolicitudes(req, res) {
    try {
      const { estado, cliente_id, analista_id, page = 1, limit = 10 } = req.query;

      const where = {};
      if (estado) where.estado = estado;
      if (cliente_id) where.cliente_id = cliente_id;
      if (analista_id) where.analista_id = analista_id;

      const offset = (page - 1) * limit;

      const { count, rows } = await this.Solicitud.findAndCountAll({
        where,
        include: [
          {
            model: this.Cliente,
            as: 'cliente',
            attributes: ['id', 'nombre', 'apellido', 'email']
          },
          {
            model: this.Analista,
            as: 'analista_revisor',
            attributes: ['id', 'nombre', 'apellido', 'rol']
          },
          {
            model: this.ModeloAprobacion,
            as: 'modelo_aprobacion',
            attributes: ['id', 'nombre']
          }
        ],
        order: [['creado_en', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      res.json({
        success: true,
        data: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          totalPages: Math.ceil(count / limit),
          limit: parseInt(limit)
        }
      });

    } catch (error) {
      console.error('Error al obtener solicitudes:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener solicitudes',
        error: error.message
      });
    }
  }

  // Obtener solicitud por ID
  async obtenerSolicitudPorId(req, res) {
    try {
      const { id } = req.params;

      const solicitud = await this.Solicitud.findByPk(id, {
        include: [
          {
            model: this.Cliente,
            as: 'cliente'
          },
          {
            model: this.Analista,
            as: 'analista_revisor'
          },
          {
            model: this.ModeloAprobacion,
            as: 'modelo_aprobacion'
          },
          {
            model: this.Prestamo,
            as: 'prestamo'
          }
        ]
      });

      if (!solicitud) {
        return res.status(404).json({
          success: false,
          message: 'Solicitud no encontrada'
        });
      }

      res.json({
        success: true,
        data: solicitud
      });

    } catch (error) {
      console.error('Error al obtener solicitud:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener solicitud',
        error: error.message
      });
    }
  }

  // Aprobar solicitud
  async aprobarSolicitud(req, res) {
    try {
      const { id } = req.params;
      const { analista_id } = req.body;

      const solicitud = await this.Solicitud.findByPk(id);
      if (!solicitud) {
        return res.status(404).json({
          success: false,
          message: 'Solicitud no encontrada'
        });
      }

      if (solicitud.estado !== 'PENDIENTE') {
        return res.status(400).json({
          success: false,
          message: `No se puede aprobar una solicitud en estado: ${solicitud.estado}`
        });
      }

      await solicitud.update({
        estado: 'APROBADO',
        analista_id: analista_id || solicitud.analista_id
      });

      res.json({
        success: true,
        message: 'Solicitud aprobada exitosamente',
        data: solicitud
      });

    } catch (error) {
      console.error('Error al aprobar solicitud:', error);
      res.status(500).json({
        success: false,
        message: 'Error al aprobar solicitud',
        error: error.message
      });
    }
  }

  // Rechazar solicitud
  async rechazarSolicitud(req, res) {
    try {
      const { id } = req.params;
      const { analista_id, razon } = req.body;

      const solicitud = await this.Solicitud.findByPk(id);
      if (!solicitud) {
        return res.status(404).json({
          success: false,
          message: 'Solicitud no encontrada'
        });
      }

      if (solicitud.estado !== 'PENDIENTE') {
        return res.status(400).json({
          success: false,
          message: `No se puede rechazar una solicitud en estado: ${solicitud.estado}`
        });
      }

      await solicitud.update({
        estado: 'RECHAZADO',
        analista_id: analista_id || solicitud.analista_id
      });

      res.json({
        success: true,
        message: 'Solicitud rechazada exitosamente',
        data: solicitud
      });

    } catch (error) {
      console.error('Error al rechazar solicitud:', error);
      res.status(500).json({
        success: false,
        message: 'Error al rechazar solicitud',
        error: error.message
      });
    }
  }

  // Actualizar solicitud
  async actualizarSolicitud(req, res) {
    try {
      const { id } = req.params;
      const { monto_solicitado, plazo_semanas, tasa_variable, modelo_aprobacion_id, modelo_calificacion, destino } = req.body;

      const solicitud = await this.Solicitud.findByPk(id);
      if (!solicitud) {
        return res.status(404).json({
          success: false,
          message: 'Solicitud no encontrada'
        });
      }

      if (solicitud.estado !== 'PENDIENTE') {
        return res.status(400).json({
          success: false,
          message: 'Solo se pueden actualizar solicitudes pendientes'
        });
      }

      const updates = {};
      if (monto_solicitado !== undefined) updates.monto_solicitado = parseFloat(monto_solicitado);
      if (plazo_semanas !== undefined) updates.plazo_semanas = parseInt(plazo_semanas);
      if (tasa_variable !== undefined) updates.tasa_variable = parseFloat(tasa_variable);
      if (modelo_aprobacion_id !== undefined) updates.modelo_aprobacion_id = modelo_aprobacion_id;
      if (modelo_calificacion !== undefined) updates.modelo_calificacion = modelo_calificacion;
      if (destino !== undefined) updates.destino = destino;

      await solicitud.update(updates);

      res.json({
        success: true,
        message: 'Solicitud actualizada exitosamente',
        data: solicitud
      });

    } catch (error) {
      console.error('Error al actualizar solicitud:', error);
      res.status(500).json({
        success: false,
        message: 'Error al actualizar solicitud',
        error: error.message
      });
    }
  }

  // Eliminar solicitud
  async eliminarSolicitud(req, res) {
    try {
      const { id } = req.params;

      const solicitud = await this.Solicitud.findByPk(id);
      if (!solicitud) {
        return res.status(404).json({
          success: false,
          message: 'Solicitud no encontrada'
        });
      }

      if (solicitud.estado !== 'PENDIENTE') {
        return res.status(400).json({
          success: false,
          message: 'Solo se pueden eliminar solicitudes pendientes'
        });
      }

      await solicitud.destroy();

      res.json({
        success: true,
        message: 'Solicitud eliminada exitosamente'
      });

    } catch (error) {
      console.error('Error al eliminar solicitud:', error);
      res.status(500).json({
        success: false,
        message: 'Error al eliminar solicitud',
        error: error.message
      });
    }
  }
}

module.exports = SolicitudController;
