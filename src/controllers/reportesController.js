const { generarReporte, TIPOS_REPORTE } = require('../services/reportesService');

const reportesController = {
  generar: async (req, res) => {
    try {
      const {
        tipo,
        fecha_inicio,
        fecha_fin,
        meta_monto,
        meta_cantidad,
        top,
        page,
        limit
      } = req.query;

      if (!tipo || !TIPOS_REPORTE.has(tipo)) {
        return res.status(400).json({
          success: false,
          message: 'tipo inválido. Valores permitidos: ganancias-esperadas-cobradas, saldo-pendiente-cliente, moras-historial-pagos, ano-contra-ano, metas, top-moras-diarias'
        });
      }

      if (!fecha_inicio || !fecha_fin) {
        return res.status(400).json({
          success: false,
          message: 'fecha_inicio y fecha_fin son requeridas'
        });
      }

      const reporte = await generarReporte({
        tipo,
        filtros: { fecha_inicio, fecha_fin, meta_monto, meta_cantidad, top, page, limit }
      });

      res.locals.audit_metadata = {
        tipo_reporte: tipo,
        fecha_inicio,
        fecha_fin
      };

      return res.json({
        success: true,
        message: 'Reporte generado correctamente',
        data: reporte
      });
    } catch (error) {
      console.error('Error generando reporte:', error);
      return res.status(400).json({
        success: false,
        message: error.message || 'Error generando reporte'
      });
    }
  }
};

module.exports = reportesController;
