const { ModeloAprobacion } = require('../models');

const modeloAprobacionController = {
  getAll: async (req, res) => {
    try {
      const modelos = await ModeloAprobacion.findAll({
        order: [['creado_en', 'DESC']]
      });
      
      res.json({
        success: true,
        data: modelos,
        total: modelos.length
      });
    } catch (error) {
      console.error('Error obteniendo modelos:', error);
      res.status(500).json({
        success: false,
        message: 'Error obteniendo modelos de aprobación'
      });
    }
  },
  
  getById: async (req, res) => {
    try {
      const modelo = await ModeloAprobacion.findByPk(req.params.id);
      
      if (!modelo) {
        return res.status(404).json({
          success: false,
          message: 'Modelo no encontrado'
        });
      }
      
      res.json({
        success: true,
        data: modelo
      });
    } catch (error) {
      console.error('Error obteniendo modelo:', error);
      res.status(500).json({
        success: false,
        message: 'Error obteniendo modelo'
      });
    }
  },
  
  create: async (req, res) => {
    try {
      const { nombre, reglas, puntaje_minimo, activo } = req.body;
      
      if (!nombre) {
        return res.status(400).json({
          success: false,
          message: 'Nombre es requerido'
        });
      }
      
      const modelo = await ModeloAprobacion.create({
        nombre,
        reglas: reglas || {},
        puntaje_minimo: puntaje_minimo || 70,
        activo: activo !== undefined ? activo : true,
        creado_en: new Date()
      });
      
      res.status(201).json({
        success: true,
        message: 'Modelo creado exitosamente',
        data: modelo
      });
    } catch (error) {
      console.error('Error creando modelo:', error);
      res.status(500).json({
        success: false,
        message: 'Error creando modelo'
      });
    }
  },
  
  update: async (req, res) => {
    try {
      const modelo = await ModeloAprobacion.findByPk(req.params.id);
      
      if (!modelo) {
        return res.status(404).json({
          success: false,
          message: 'Modelo no encontrado'
        });
      }
      
      await modelo.update(req.body);
      
      res.json({
        success: true,
        message: 'Modelo actualizado exitosamente',
        data: modelo
      });
    } catch (error) {
      console.error('Error actualizando modelo:', error);
      res.status(500).json({
        success: false,
        message: 'Error actualizando modelo'
      });
    }
  },
  
  delete: async (req, res) => {
    try {
      const modelo = await ModeloAprobacion.findByPk(req.params.id);
      
      if (!modelo) {
        return res.status(404).json({
          success: false,
          message: 'Modelo no encontrado'
        });
      }
      
      await modelo.destroy();
      
      res.json({
        success: true,
        message: 'Modelo eliminado exitosamente'
      });
    } catch (error) {
      console.error('Error eliminando modelo:', error);
      res.status(500).json({
        success: false,
        message: 'Error eliminando modelo'
      });
    }
  }
};

module.exports = modeloAprobacionController;