const { getAnalistaPermissionCodes } = require('../middleware/auth');
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
          message: 'tipo inválido. Valores permitidos: ganancias-esperadas-cobradas, saldo-pendiente-cliente, moras-historial-pagos, ano-contra-ano, metas, top-moras-diarias, cuotas-pendientes-correo-admin'
        });
      }

      if (!fecha_inicio || !fecha_fin) {
        return res.status(400).json({
          success: false,
          message: 'fecha_inicio y fecha_fin son requeridas'
        });
      }

      if (tipo === 'cuotas-pendientes-correo-admin' && req.user?.rol !== 'ADMINISTRADOR') {
        const userPermissions = req.user?.permission_codes?.length
          ? req.user.permission_codes
          : await getAnalistaPermissionCodes(req.user.id);

        if (!userPermissions.includes('reportes.manage')) {
          return res.status(403).json({
            success: false,
            message: 'No tienes permisos para realizar esta acción.',
            code: 'FORBIDDEN'
          });
        }
      }

      const reporte = await generarReporte({
        tipo,
        filtros: { fecha_inicio, fecha_fin, meta_monto, meta_cantidad, top, page, limit },
        user: req.user
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
