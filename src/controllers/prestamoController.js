const { Prestamo, Solicitud, Cliente } = require('../models');

class PrestamoController {
  async crearPrestamo(req, res) {
    try {
      const { solicitud_id, monto_solicitado, interes, modalidad, num_semanas } = req.body;
      
      const prestamo = await Prestamo.create({
        solicitud_id,
        monto_solicitado,
        interes: interes || 12,
        modalidad: modalidad || 'SEMANAL',
        num_semanas: num_semanas || 0,
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
        message: 'Error creando préstamo',
        error: error.message
      });
    }
  }
  
  async obtenerPrestamos(req, res) {
    try {
      const prestamos = await Prestamo.findAll({
        include: [{
          model: Solicitud,
          as: 'solicitud',
          include: [{
            model: Cliente,
            as: 'cliente'
          }]
        }],
        order: [['fecha_inicio', 'DESC']]
      });
      
      res.json({
        success: true,
        data: prestamos
      });
    } catch (error) {
      console.error('Error obteniendo préstamos:', error);
      res.status(500).json({
        success: false,
        message: 'Error obteniendo préstamos',
        error: error.message
      });
    }
  }
}

module.exports = new PrestamoController();