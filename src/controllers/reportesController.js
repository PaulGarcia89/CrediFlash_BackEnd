const {
  generarReporte,
  generarKpisResumen,
  exportReport,
  enviarCuotasPendientesAdmin,
  TIPOS_REPORTE,
  ensureReportTables
} = require('../services/reportesService');

const tipoErrorMap = {
  REPORT_TYPE_INVALID: 400,
  REPORT_DATE_INVALID: 400,
  REPORT_DATE_RANGE_INVALID: 400,
  REPORT_DATE_RANGE_TOO_LARGE: 400
};

const toErrorResponse = (error, fallbackMessage = 'Error generando reporte') => {
  const error_code = error?.error_code || 'REPORT_INTERNAL_ERROR';
  const status = tipoErrorMap[error_code] || 500;
  return {
    status,
    body: {
      success: false,
      message: error?.message || fallbackMessage,
      error_code,
      details: error?.details || []
    }
  };
};

const validarTipo = (tipo) => {
  if (!tipo || !TIPOS_REPORTE.has(tipo)) {
    const error = new Error('tipo no soportado');
    error.error_code = 'REPORT_TYPE_INVALID';
    throw error;
  }
};

const reportesController = {
  generar: async (req, res) => {
    try {
      await ensureReportTables();
      const {
        tipo,
        fecha_inicio,
        fecha_fin,
        page,
        limit,
        search,
        analista_id,
        estado,
        modalidad,
        top,
        meta_monto,
        meta_cantidad
      } = req.query;

      validarTipo(tipo);

      const data = await generarReporte({
        tipo,
        filtros: {
          fecha_inicio,
          fecha_fin,
          page,
          limit,
          search,
          analista_id,
          estado,
          modalidad,
          top,
          meta_monto,
          meta_cantidad
        },
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
        data
      });
    } catch (error) {
      const payload = toErrorResponse(error);
      return res.status(payload.status).json(payload.body);
    }
  },

  kpisResumen: async (req, res) => {
    try {
      await ensureReportTables();
      const { fecha_inicio, fecha_fin } = req.query;
      const data = await generarKpisResumen({
        filtros: { fecha_inicio, fecha_fin },
        user: req.user
      });

      return res.json({
        success: true,
        message: 'KPIs generados correctamente',
        data
      });
    } catch (error) {
      const payload = toErrorResponse(error, 'Error generando KPIs');
      return res.status(payload.status).json(payload.body);
    }
  },

  exportar: async (req, res) => {
    try {
      await ensureReportTables();
      const {
        tipo,
        fecha_inicio,
        fecha_fin,
        search,
        analista_id,
        estado,
        modalidad,
        top,
        meta_monto,
        meta_cantidad,
        formato = 'csv'
      } = req.query;

      validarTipo(tipo);

      const normalizedFormat = String(formato || 'csv').toLowerCase();
      if (!['csv', 'xlsx'].includes(normalizedFormat)) {
        return res.status(400).json({
          success: false,
          message: 'formato inválido. Use csv o xlsx',
          error_code: 'REPORT_EXPORT_FORMAT_INVALID',
          details: []
        });
      }

      const { filename, buffer, contentType } = await exportReport({
        tipo,
        formato: normalizedFormat,
        filtros: {
          fecha_inicio,
          fecha_fin,
          search,
          analista_id,
          estado,
          modalidad,
          top,
          meta_monto,
          meta_cantidad
        },
        user: req.user
      });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      const payload = toErrorResponse(error, 'Error exportando reporte');
      return res.status(payload.status).json(payload.body);
    }
  },

  cuotasPendientesCorreoAdmin: async (req, res) => {
    try {
      const { fecha_inicio, fecha_fin, admin_email } = req.query;
      const adminEmail = admin_email || process.env.ADMIN_REPORT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;

      if (!adminEmail) {
        return res.status(400).json({
          success: false,
          message: 'No se encontró correo de administrador destino',
          error_code: 'REPORT_ADMIN_EMAIL_MISSING',
          details: []
        });
      }

      const resumen = await enviarCuotasPendientesAdmin({
        filtros: { fecha_inicio, fecha_fin },
        adminEmail,
        user: req.user
      });

      return res.json({
        success: true,
        message: 'Reporte enviado al administrador',
        data: resumen
      });
    } catch (error) {
      const payload = toErrorResponse(error, 'Error enviando reporte al administrador');
      return res.status(payload.status).json(payload.body);
    }
  }
};

module.exports = reportesController;
