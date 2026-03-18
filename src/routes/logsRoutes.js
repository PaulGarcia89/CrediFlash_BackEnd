const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { AuditLog } = require('../models');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { sendCsv } = require('../utils/exporter');

const parseDate = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
};

const buildWhere = (query) => {
  const where = {};
  const {
    search,
    modulo,
    accion,
    resultado,
    analista_id,
    fecha_desde,
    fecha_hasta
  } = query;

  if (modulo) where.modulo = modulo;
  if (accion) where.accion = { [Op.iLike]: `%${accion}%` };
  if (resultado) where.resultado = resultado;
  if (analista_id) where.analista_id = analista_id;

  const desde = parseDate(fecha_desde);
  const hasta = parseDate(fecha_hasta, true);
  if (desde || hasta) {
    where.created_at = {};
    if (desde) where.created_at[Op.gte] = desde;
    if (hasta) where.created_at[Op.lte] = hasta;
  }

  if (search) {
    where[Op.or] = [
      { analista_nombre: { [Op.iLike]: `%${search}%` } },
      { analista_email: { [Op.iLike]: `%${search}%` } },
      { accion: { [Op.iLike]: `%${search}%` } },
      { modulo: { [Op.iLike]: `%${search}%` } },
      { entidad_id: { [Op.iLike]: `%${search}%` } }
    ];
  }

  return where;
};

router.get('/', authenticateToken, requirePermission('logs.view'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = (page - 1) * limit;
    const where = buildWhere(req.query);

    const { count, rows } = await AuditLog.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listando audit logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Error obteniendo logs'
    });
  }
});

router.get('/export', authenticateToken, requirePermission('logs.manage'), async (req, res) => {
  try {
    const where = buildWhere(req.query);
    const rows = await AuditLog.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: 50000
    });

    return sendCsv(res, {
      filename: `audit_logs_${Date.now()}.csv`,
      headers: [
        { key: 'id', label: 'id' },
        { key: 'created_at', label: 'created_at' },
        { key: 'analista_id', label: 'analista_id' },
        { key: 'analista_nombre', label: 'analista_nombre' },
        { key: 'analista_email', label: 'analista_email' },
        { key: 'rol_nombre', label: 'rol_nombre' },
        { key: 'modulo', label: 'modulo' },
        { key: 'accion', label: 'accion' },
        { key: 'entidad', label: 'entidad' },
        { key: 'entidad_id', label: 'entidad_id' },
        { key: 'metodo_http', label: 'metodo_http' },
        { key: 'endpoint', label: 'endpoint' },
        { key: 'status_code', label: 'status_code' },
        { key: 'resultado', label: 'resultado' },
        { key: 'ip', label: 'ip' },
        { key: 'user_agent', label: 'user_agent' },
        { key: 'request_id', label: 'request_id' },
        { key: 'metadata', label: 'metadata' },
        { key: 'error_message', label: 'error_message' }
      ],
      rows: rows.map((item) => ({
        ...item.toJSON(),
        metadata: item.metadata ? JSON.stringify(item.metadata) : null
      }))
    });
  } catch (error) {
    console.error('Error exportando logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Error exportando logs'
    });
  }
});

router.get('/:id', authenticateToken, requirePermission('logs.view'), async (req, res) => {
  try {
    const log = await AuditLog.findByPk(req.params.id);
    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Log no encontrado'
      });
    }

    return res.json({
      success: true,
      data: log
    });
  } catch (error) {
    console.error('Error obteniendo log por id:', error);
    return res.status(500).json({
      success: false,
      message: 'Error obteniendo log'
    });
  }
});

router.delete('/', authenticateToken, requirePermission('logs.manage'), async (req, res) => {
  try {
    const { fecha_hasta } = req.query;
    const hasta = parseDate(fecha_hasta, true);
    if (!hasta) {
      return res.status(400).json({
        success: false,
        message: 'fecha_hasta es requerida (YYYY-MM-DD)'
      });
    }

    const deleted = await AuditLog.destroy({
      where: {
        created_at: { [Op.lte]: hasta }
      }
    });

    return res.json({
      success: true,
      message: 'Logs eliminados correctamente',
      data: { deleted }
    });
  } catch (error) {
    console.error('Error limpiando logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Error eliminando logs'
    });
  }
});

module.exports = router;
